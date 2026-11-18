import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { t } from "@homematch/i18n";
import { PrivateNetworkError, assertPublicUrl, publicDispatcher } from "./net.js";

/** Honest app identification (the OSM/Nominatim usage policy asks for a dedicated User-Agent). */
export const APP_UA = "HomeMatch/0.1 (rental search map; https://github.com/phtoselli/HomeMatch)";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * Data folder (cache of third-party content, outside git). Default: `data/` at the repository root, whatever folder
 * the app was started from; in production it comes from DATA_DIR.
 */
export const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL("../../../data", import.meta.url));
const CACHE_DIR = join(DATA_DIR, "cache");

// ---------- file cache ----------

function cachePath(ns: string, key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  // The namespace becomes a folder: no ":" or other characters Windows rejects ("site:host" → "site_host").
  return join(CACHE_DIR, ns.replace(/[^\w.-]/g, "_"), `${h}.json`);
}

export async function cacheGet<T>(ns: string, key: string, ttlMs: number = Infinity): Promise<T | undefined> {
  try {
    const raw = JSON.parse(await readFile(cachePath(ns, key), "utf8")) as { savedAt: number; value: T };
    if (Date.now() - raw.savedAt <= ttlMs) return raw.value;
  } catch {
    /* not cached */
  }
  return undefined;
}

export async function cacheSet<T>(ns: string, key: string, value: T): Promise<void> {
  const p = cachePath(ns, key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ savedAt: Date.now(), key, value }));
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ---------- second level: cache shared across instances ----------

/** The minimum of a remote key-value cache (on Vercel, the Runtime Cache from `@vercel/functions`). */
export interface SharedCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts: { ttl: number; name?: string }): Promise<void>;
}

let shared: SharedCache | undefined;

/**
 * Enables a shared cache. On Vercel the disk (`/tmp`) belongs to each instance and disappears when it shuts down;
 * without this, every session would start cold, waiting for Overpass (tens of seconds per query).
 */
export function useSharedCache(c: SharedCache | undefined): void {
  shared = c;
}

/** Reference data only (OSM, addresses, bus network): listings change quickly and stay in the local cache. */
const SHARED_MIN_TTL = DAY;
/** The Runtime Cache does not store items above 2 MB. */
const SHARED_MAX_CHARS = 1_900_000;
const sharedKey = (ns: string, key: string) => `${ns}/${createHash("sha1").update(key).digest("hex")}`;

async function sharedGet<T>(ns: string, key: string, ttlMs: number, maxAgeMs = ttlMs): Promise<T | undefined> {
  if (!shared || ttlMs < SHARED_MIN_TTL) return undefined;
  try {
    const raw = await shared.get(sharedKey(ns, key));
    if (typeof raw !== "string") return undefined;
    const item = JSON.parse(gunzipSync(Buffer.from(raw, "base64")).toString("utf8")) as { savedAt: number; value: T };
    return Date.now() - item.savedAt <= maxAgeMs ? item.value : undefined;
  } catch {
    return undefined; // remote cache down or quota exhausted: carry on without it
  }
}

async function sharedSet<T>(ns: string, key: string, ttlMs: number, value: T): Promise<void> {
  if (!shared || ttlMs < SHARED_MIN_TTL) return;
  try {
    const raw = gzipSync(JSON.stringify({ savedAt: Date.now(), value })).toString("base64");
    // Kept longer than its validity: if the source goes down, the old value still serves (see `cached`).
    if (raw.length <= SHARED_MAX_CHARS)
      await shared.set(sharedKey(ns, key), raw, { ttl: Math.round((ttlMs * STALE_FACTOR) / 1000), name: ns });
  } catch {
    /* no remote cache: the local one is already written */
  }
}

/** How long past its validity an old value is kept in case the source goes down. */
const STALE_FACTOR = 4;

/**
 * Two-level cache: local disk and, when enabled, the shared one. If the source fails (Overpass at capacity, site
 * down), it returns any expired value instead of failing the search: map data from a few days ago still serves.
 */
export async function cached<T>(ns: string, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(ns, key, ttlMs);
  if (hit !== undefined) return hit;
  const remote = await sharedGet<T>(ns, key, ttlMs);
  if (remote !== undefined) {
    await cacheSet(ns, key, remote);
    return remote;
  }
  let value: T;
  try {
    value = await fn();
  } catch (e) {
    const stale = (await cacheGet<T>(ns, key)) ?? (await sharedGet<T>(ns, key, ttlMs, ttlMs * STALE_FACTOR));
    if (stale !== undefined) return stale;
    throw e;
  }
  await cacheSet(ns, key, value);
  await sharedSet(ns, key, ttlMs, value);
  return value;
}

// ---------- per-host rate limit ----------

const nextSlot = new Map<string, number>();

/** Ensures a minimum interval between requests to the same host (simple queue). */
export async function throttle(host: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + minIntervalMs);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} at ${url}: ${body.slice(0, 200)}`);
  }
}

export interface FetchOpts extends RequestInit {
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
}

const isPrivateNetwork = (e: unknown) =>
  e instanceof PrivateNetworkError || (e as { cause?: unknown })?.cause instanceof PrivateNetworkError;

/**
 * fetch with timeout, per-host pacing and retries on 429/5xx/network errors.
 * Only talks to public addresses (`net.ts`): the URL text is checked here, the IP when connecting.
 */
export async function httpFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { minIntervalMs = 500, timeoutMs = 60_000, retries = 2, ...init } = opts;
  const host = assertPublicUrl(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, minIntervalMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": APP_UA, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
        // Node's fetch accepts undici's dispatcher (not part of the DOM types).
        dispatcher: publicDispatcher,
      } as RequestInit);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, url, await res.text().catch(() => ""));
      } else {
        return res;
      }
    } catch (e) {
      if (isPrivateNetwork(e)) throw new PrivateNetworkError();
      lastErr = e;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr;
}

/**
 * Reads the body as text up to `maxBytes` (a page pasted by the user may be a huge file).
 * Past the limit, it stops downloading and throws.
 */
export async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new Error(t.sources.pageTooLarge(Math.round(declared / 1e6)));
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(t.sources.pageOverLimit(Math.round(maxBytes / 1e6)));
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function httpJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await httpFetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return JSON.parse(text) as T;
}
