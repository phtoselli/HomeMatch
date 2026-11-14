import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Identificação honesta do app (política de uso do OSM/Nominatim pede um User-Agent próprio). */
export const APP_UA = "HomeMatch/0.1 (ferramenta pessoal de busca de aluguel)";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const CACHE_DIR = join(process.cwd(), "data", "cache");

// ---------- cache em arquivo ----------

function cachePath(ns: string, key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  // O namespace vira pasta: sem ":" e outros caracteres que o Windows não aceita ("site:host" → "site_host").
  return join(CACHE_DIR, ns.replace(/[^\w.-]/g, "_"), `${h}.json`);
}

export async function cacheGet<T>(ns: string, key: string, ttlMs: number): Promise<T | undefined> {
  try {
    const raw = JSON.parse(await readFile(cachePath(ns, key), "utf8")) as { savedAt: number; value: T };
    if (Date.now() - raw.savedAt <= ttlMs) return raw.value;
  } catch {
    /* sem cache */
  }
  return undefined;
}

export async function cacheSet<T>(ns: string, key: string, value: T): Promise<void> {
  const p = cachePath(ns, key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ savedAt: Date.now(), key, value }));
}

export async function cached<T>(ns: string, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(ns, key, ttlMs);
  if (hit !== undefined) return hit;
  const value = await fn();
  await cacheSet(ns, key, value);
  return value;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ---------- limite de ritmo por host ----------

const nextSlot = new Map<string, number>();

/** Garante um intervalo mínimo entre requisições ao mesmo host (fila simples). */
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
    super(`HTTP ${status} em ${url}: ${body.slice(0, 200)}`);
  }
}

export interface FetchOpts extends RequestInit {
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
}

/** fetch com timeout, ritmo por host e novas tentativas em 429/5xx/erro de rede. */
export async function httpFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { minIntervalMs = 500, timeoutMs = 60_000, retries = 2, ...init } = opts;
  const host = new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, minIntervalMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": APP_UA, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, url, await res.text().catch(() => ""));
      } else {
        return res;
      }
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr;
}

export async function httpJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await httpFetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return JSON.parse(text) as T;
}
