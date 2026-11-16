import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { PrivateNetworkError, assertPublicUrl, publicDispatcher } from "./net.js";

/** Identificação honesta do app (política de uso do OSM/Nominatim pede um User-Agent próprio). */
export const APP_UA = "HomeMatch/0.1 (ferramenta pessoal de busca de aluguel)";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * Pasta de dados (cache de conteúdo de terceiros, fora do git). Padrão: `data/` na raiz do repositório,
 * qualquer que seja a pasta de onde o app foi iniciado; em produção vem de DATA_DIR.
 */
export const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL("../../../data", import.meta.url));
const CACHE_DIR = join(DATA_DIR, "cache");

// ---------- cache em arquivo ----------

function cachePath(ns: string, key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  // O namespace vira pasta: sem ":" e outros caracteres que o Windows não aceita ("site:host" → "site_host").
  return join(CACHE_DIR, ns.replace(/[^\w.-]/g, "_"), `${h}.json`);
}

export async function cacheGet<T>(ns: string, key: string, ttlMs: number = Infinity): Promise<T | undefined> {
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

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ---------- segundo nível: cache compartilhado entre instâncias ----------

/** O mínimo de um cache chave-valor remoto (na Vercel, o Runtime Cache de `@vercel/functions`). */
export interface SharedCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts: { ttl: number; name?: string }): Promise<void>;
}

let shared: SharedCache | undefined;

/**
 * Liga um cache compartilhado. Na Vercel o disco (`/tmp`) é de cada instância e some quando ela desliga; sem isso,
 * toda sessão começaria fria, esperando o Overpass (dezenas de segundos por consulta).
 */
export function useSharedCache(c: SharedCache | undefined): void {
  shared = c;
}

/** Só dado de referência (OSM, endereços, rede de ônibus): anúncio muda rápido e fica só no cache local. */
const SHARED_MIN_TTL = DAY;
/** O Runtime Cache não guarda itens acima de 2 MB. */
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
    return undefined; // cache remoto fora do ar ou cota esgotada: segue sem ele
  }
}

async function sharedSet<T>(ns: string, key: string, ttlMs: number, value: T): Promise<void> {
  if (!shared || ttlMs < SHARED_MIN_TTL) return;
  try {
    const raw = gzipSync(JSON.stringify({ savedAt: Date.now(), value })).toString("base64");
    // Guarda por mais tempo que a validade: se a fonte cair, o valor antigo ainda serve (ver `cached`).
    if (raw.length <= SHARED_MAX_CHARS)
      await shared.set(sharedKey(ns, key), raw, { ttl: Math.round((ttlMs * STALE_FACTOR) / 1000), name: ns });
  } catch {
    /* sem cache remoto: o local já foi gravado */
  }
}

/** Quanto tempo além da validade o valor antigo fica guardado para o caso de a fonte cair. */
const STALE_FACTOR = 4;

/**
 * Cache em dois níveis: disco local e, se ligado, o compartilhado. Se a fonte falhar (Overpass lotado, site fora do
 * ar), devolve o valor vencido que houver em vez de derrubar a busca: dado de mapa de alguns dias atrás serve.
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

const isPrivateNetwork = (e: unknown) =>
  e instanceof PrivateNetworkError || (e as { cause?: unknown })?.cause instanceof PrivateNetworkError;

/**
 * fetch com timeout, ritmo por host e novas tentativas em 429/5xx/erro de rede.
 * Só fala com endereços públicos (`net.ts`): texto da URL conferido aqui, IP conferido na conexão.
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
        // O fetch do Node aceita o dispatcher do undici (fora dos tipos do DOM).
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
 * Lê o corpo como texto até `maxBytes` (página colada pelo usuário pode ser um arquivo enorme).
 * Passou do limite, para de baixar e dá erro.
 */
export async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new Error(`página grande demais (${Math.round(declared / 1e6)} MB)`);
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
      throw new Error(`página grande demais (mais de ${Math.round(maxBytes / 1e6)} MB)`);
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
