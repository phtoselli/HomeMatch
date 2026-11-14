import type { LatLng, Listing } from "../../../shared/types.js";
import { padBBox } from "../../geo.js";
import { BROWSER_UA, HOUR, cached, httpFetch } from "../../http.js";
import { geocodeInBox } from "../../osm/nominatim.js";
import { detectAmenities, normalizeType, slugify } from "../normalize.js";
import { SourceBlockedError, type SearchArgs, type SourceAdapter } from "../types.js";
import { robotsStatus } from "./robots.js";
import type { PageCtx, RawListing, SiteExtension } from "./types.js";

/**
 * Motor comum das extensões: tudo o que é igual em qualquer site.
 * - robots.txt respeitado antes de cada página;
 * - ritmo por site, cache de 6 h e pausa de 15 min quando o site bloqueia (sem tentar contornar);
 * - paginação até o teto da extensão;
 * - anúncio cru → `Listing` (total, tipo, comodidades, ids) e posição no mapa
 *   (coordenada do site; senão endereço geocodificado ou o centro do bairro, marcada como aproximada).
 */

const BLOCK_COOLDOWN_MS = 15 * 60_000;
const MAX_GEOCODES_PER_REGION = 25;
const blockedUntil = new Map<string, number>();

export class RobotsDisallowedError extends SourceBlockedError {}

/** Página de desafio (Cloudflare, captcha): o site barrou robôs. */
export const isChallengePage = (html: string) =>
  /<title>\s*(Just a moment|Attention Required|Access denied|Acesso negado)/i.test(html) ||
  /cf-chl-|challenges\.cloudflare\.com\/turnstile|g-recaptcha"|hcaptcha\.com\/1\/api/i.test(html.slice(0, 20_000));

/** Baixa uma página para a extensão (robots.txt, ritmo, cache e bloqueio). 404 vira página vazia. */
export async function fetchPage(ext: Pick<SiteExtension, "id" | "label" | "minIntervalMs">, url: string): Promise<string> {
  const robots = await robotsStatus(url);
  if (robots === "deny") throw new RobotsDisallowedError("o site pede para robôs não lerem essa página (robots.txt); respeitando");
  if (robots === "erro") throw new Error("o site não respondeu");
  return cached(`site-${ext.id}`, url, 6 * HOUR, async () => {
    if (Date.now() < (blockedUntil.get(ext.id) ?? 0)) {
      throw new SourceBlockedError("o site bloqueou a leitura automática há pouco; tente de novo em alguns minutos");
    }
    const res = await httpFetch(url, {
      minIntervalMs: ext.minIntervalMs ?? 1500,
      retries: 1,
      timeoutMs: 30_000,
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
    });
    const body = res.status === 404 ? "" : await res.text();
    // Bloqueio não vai para o cache: é passageiro e não quer dizer "não tem anúncio".
    if (res.status === 403 || res.status === 429 || isChallengePage(body)) {
      blockedUntil.set(ext.id, Date.now() + BLOCK_COOLDOWN_MS);
      throw new SourceBlockedError(`o site bloqueou a leitura automática (HTTP ${res.status}); tente mais tarde`);
    }
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    return body;
  });
}

/** Percorre as páginas da busca e junta os anúncios (sem repetir). */
export async function collectRaw(ext: SiteExtension, ctx: Omit<PageCtx, "page">, maxItems: number): Promise<RawListing[]> {
  const seen = new Map<string, RawListing>();
  let url = ext.url({ ...ctx, page: 1 });
  for (let page = 1; url && page <= ext.maxPages && seen.size < maxItems; page++) {
    let body: string;
    try {
      body = await fetchPage(ext, url);
    } catch (e) {
      // Página seguinte proibida pelo robots.txt: fica com o que já leu.
      if (e instanceof RobotsDisallowedError && page > 1) break;
      throw e;
    }
    const got = ext.parse(body, url);
    let fresh = 0;
    for (const r of got) if (!seen.has(r.id)) (seen.set(r.id, r), fresh++);
    if (got.length < ext.perPage || !fresh) break;
    url = ext.next ? ext.next(body, url, { ...ctx, page }) : ext.url({ ...ctx, page: page + 1 });
  }
  return [...seen.values()];
}

// ---------- posição no mapa ----------

const GENERIC = /^(jardim|jd|parque|pq|vila|vl|chacara|residencial|conjunto|nucleo|loteamento|condominio|cidade|bairro|recanto|sitio)-/;
const core = (s: string) => slugify(s).replace(GENERIC, "");

/** "Taquaral" casa com "Parque Taquaral"; "Cambuí" com "cambui". */
export function sameName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = core(a);
  const y = core(b);
  return !!x && !!y && (x === y || (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y)));
}

/** Posição estável perto do centro da região quando o endereço não é encontrado. */
export function jitter(center: LatLng, seed: string): LatLng {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * (Math.PI / 180);
  const r = 0.0015 + ((h >>> 9) % 100) / 100000;
  return { lat: center.lat + r * Math.sin(ang), lng: center.lng + r * Math.cos(ang) };
}

/** Sala, galpão, terreno…: não é moradia. */
const COMMERCIAL = /\b(salas?|sal[aã]o|galp[aã]o|barrac[aã]o|terrenos?|lotes?|lojas?|ponto comercial|pr[eé]dio|dep[oó]sito|escrit[oó]rio|consult[oó]rio|ch[aá]cara|s[ií]tio|fazenda|box|vaga de garagem)\b/i;

export function isHome(r: Pick<RawListing, "typeLabel" | "title">): boolean {
  const label = r.typeLabel ?? r.title?.split(/\s[-|–,]\s|\spara\s/i)[0] ?? "";
  return !(normalizeType(label) === "outro" && COMMERCIAL.test(label));
}

export interface SourceMeta {
  id: string;
  label: string;
}

/** Anúncio cru → `Listing`. */
export function toListing(r: RawListing, src: SourceMeta, pos: LatLng, approx: boolean): Listing {
  const total = r.total ?? r.rent + (r.condo ?? 0) + (r.iptu ?? 0);
  const typeLabel = r.typeLabel ?? r.title?.split(/\s[-|–,]\s|\spara\s|\scom\s/i)[0]?.trim() ?? "Imóvel";
  const found = detectAmenities([r.title, r.description].filter(Boolean).join(" "));
  return {
    id: `${src.id}:${r.id}`,
    source: src.id,
    sourceLabel: src.label,
    agency: r.agency,
    url: r.url,
    title: r.title ?? typeLabel,
    type: normalizeType(`${typeLabel} ${r.title ?? ""}`),
    typeLabel: typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1),
    rent: r.rent,
    total,
    condo: r.condo,
    iptu: r.iptu,
    area: r.area,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    parking: r.parking,
    address: [r.street, r.neighbourhood].filter(Boolean).join(", ") || undefined,
    neighbourhood: r.neighbourhood,
    lat: pos.lat,
    lng: pos.lng,
    approxLocation: approx,
    image: r.image,
    // Só a descrição completa permite dizer "não tem": sem ela, o que não aparece fica "sem informação".
    amenities: found.length ? found : undefined,
  };
}

/** Coloca os anúncios crus no mapa, dentro da região pedida. */
export async function locate(raws: RawListing[], ext: Pick<SiteExtension, "scope">, args: Pick<SearchArgs, "city" | "region">, src: SourceMeta): Promise<Listing[]> {
  const { city, region } = args;
  const box = padBBox(region.bbox, 1500);
  const geocoded = new Map<string, LatLng | null>();
  const out: Listing[] = [];
  for (const r of raws) {
    if (!isHome(r)) continue;
    if (r.cityName && !sameName(r.cityName, city.name)) continue; // outra cidade
    if (r.geo) {
      out.push(toListing(r, src, r.geo, false)); // o servidor tira os de fora da região
      continue;
    }
    // Sem coordenada: na busca da cidade inteira, só fica o que diz ser deste bairro.
    if (ext.scope === "city" && !sameName(r.neighbourhood, region.name)) continue;
    let pos: LatLng | null = null;
    if (r.street) {
      const q = `${r.street}, ${r.neighbourhood ?? region.name}, ${city.name}`;
      if (!geocoded.has(q) && geocoded.size < MAX_GEOCODES_PER_REGION) geocoded.set(q, await geocodeInBox(q, box));
      pos = geocoded.get(q) ?? null;
    }
    out.push(toListing(r, src, pos ?? jitter(region, r.id), !pos));
  }
  return out;
}

/** Transforma uma extensão numa fonte de anúncios que o servidor sabe usar. */
export function extensionSource(ext: SiteExtension, meta: Partial<SourceMeta> & { site?: string } = {}): SourceAdapter {
  const src: SourceMeta = { id: meta.id ?? ext.id, label: meta.label ?? ext.label };
  return {
    id: src.id,
    label: src.label,
    async search(args) {
      const ctx = { city: args.city, region: args.region, filters: args.filters, site: meta.site };
      const raws = await collectRaw(ext, ctx, ext.scope === "city" ? Infinity : args.max);
      const listings = await locate(raws, ext, args, src);
      args.log(`${src.label} · ${args.region.name}: ${listings.length} anúncios`);
      return listings;
    },
  };
}
