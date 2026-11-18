import type { LatLng, Listing } from "@homematch/contracts";
import { padBBox } from "@homematch/domain";
import { BROWSER_UA, HOUR, cached, httpFetch } from "../../http.js";
import { geocodeInBox } from "../../osm/nominatim.js";
import { detectAmenities, normalizeType, slugify } from "../normalize.js";
import { SourceBlockedError, type SearchArgs, type SourceAdapter } from "../types.js";
import { robotsStatus } from "./robots.js";
import type { PageCtx, RawListing, SiteExtension } from "./types.js";
import { t } from "@homematch/i18n";

/**
 * Shared engine for the extensions: everything that is the same on any site.
 * - robots.txt honored before every page;
 * - per-site pacing, 6 h cache and a 15 min pause when the site blocks (no attempt to get around it);
 * - pagination up to the extension's cap;
 * - raw listing → `Listing` (total, type, amenities, ids) and map position
 *   (the site's coordinates; otherwise a geocoded address or the neighborhood center, marked as approximate).
 */

const BLOCK_COOLDOWN_MS = 15 * 60_000;
const MAX_GEOCODES_PER_REGION = 25;
const blockedUntil = new Map<string, number>();

export class RobotsDisallowedError extends SourceBlockedError {}

/** Challenge page (Cloudflare, captcha): the site blocked robots. */
export const isChallengePage = (html: string) =>
  /<title>\s*(Just a moment|Attention Required|Access denied|Acesso negado)/i.test(html) ||
  /cf-chl-|challenges\.cloudflare\.com\/turnstile|g-recaptcha"|hcaptcha\.com\/1\/api/i.test(html.slice(0, 20_000));

/** Downloads a page for an extension (robots.txt, pacing, cache and blocking). 404 becomes an empty page. */
export async function fetchPage(
  ext: Pick<SiteExtension, "id" | "label" | "minIntervalMs">,
  url: string,
): Promise<string> {
  const robots = await robotsStatus(url);
  if (robots === "deny") throw new RobotsDisallowedError(t.sources.robotsPage);
  if (robots === "error") throw new Error(t.sources.siteDown);
  return cached(`site-${ext.id}`, url, 6 * HOUR, async () => {
    if (Date.now() < (blockedUntil.get(ext.id) ?? 0)) {
      throw new SourceBlockedError(t.sources.blockedRecently);
    }
    const res = await httpFetch(url, {
      minIntervalMs: ext.minIntervalMs ?? 1500,
      retries: 1,
      timeoutMs: 30_000,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "pt-BR,pt;q=0.9",
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const body = res.status === 404 ? "" : await res.text();
    // A block is not cached: it is temporary and does not mean "no listings".
    if (res.status === 403 || res.status === 429 || isChallengePage(body)) {
      blockedUntil.set(ext.id, Date.now() + BLOCK_COOLDOWN_MS);
      throw new SourceBlockedError(t.sources.blocked(res.status));
    }
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    return body;
  });
}

/** Walks the search pages and collects listings (without repeats). */
export async function collectRaw(
  ext: SiteExtension,
  ctx: Omit<PageCtx, "page">,
  maxItems: number,
): Promise<RawListing[]> {
  const seen = new Map<string, RawListing>();
  let url = ext.url({ ...ctx, page: 1 });
  for (let page = 1; url && page <= ext.maxPages && seen.size < maxItems; page++) {
    let body: string;
    try {
      body = await fetchPage(ext, url);
    } catch (e) {
      // Next page disallowed by robots.txt: keep what was read so far.
      if (e instanceof RobotsDisallowedError && page > 1) break;
      throw e;
    }
    const got = ext.parse(body, url);
    let fresh = 0;
    for (const r of got) {
      if (seen.has(r.id)) continue;
      seen.set(r.id, r);
      fresh++;
    }
    if (got.length < ext.perPage || !fresh) break;
    url = ext.next ? ext.next(body, url, { ...ctx, page }) : ext.url({ ...ctx, page: page + 1 });
  }
  return [...seen.values()];
}

// ---------- map position ----------

const GENERIC =
  /^(jardim|jd|parque|pq|vila|vl|chacara|residencial|conjunto|nucleo|loteamento|condominio|cidade|bairro|recanto|sitio)-/;
const core = (s: string) => slugify(s).replace(GENERIC, "");

/** "Taquaral" matches "Parque Taquaral"; "Cambuí" matches "cambui". */
export function sameName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = core(a);
  const y = core(b);
  return !!x && !!y && (x === y || (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y)));
}

/** Stable position near the region center when the address is not found. */
export function jitter(center: LatLng, seed: string): LatLng {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * (Math.PI / 180);
  const r = 0.0015 + ((h >>> 9) % 100) / 100000;
  return { lat: center.lat + r * Math.sin(ang), lng: center.lng + r * Math.cos(ang) };
}

/** Office, warehouse, land…: not a home (Portuguese listing words). */
const COMMERCIAL =
  /\b(salas?|sal[aã]o|galp[aã]o|barrac[aã]o|terrenos?|lotes?|lojas?|ponto comercial|pr[eé]dio|dep[oó]sito|escrit[oó]rio|consult[oó]rio|ch[aá]cara|s[ií]tio|fazenda|box|vaga de garagem)\b/i;

export function isHome(r: Pick<RawListing, "typeLabel" | "title">): boolean {
  const label = r.typeLabel ?? r.title?.split(/\s[-|–,]\s|\spara\s/i)[0] ?? "";
  return !(normalizeType(label) === "other" && COMMERCIAL.test(label));
}

export interface SourceMeta {
  id: string;
  label: string;
}

/** Raw listing → `Listing`. */
export function toListing(r: RawListing, src: SourceMeta, pos: LatLng, approx: boolean): Listing {
  const total = r.total ?? r.rent + (r.condo ?? 0) + (r.iptu ?? 0);
  const typeLabel = r.typeLabel ?? r.title?.split(/\s[-|–,]\s|\spara\s|\scom\s/i)[0]?.trim() ?? t.links.property;
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
    // Only the full description allows saying "does not have": without it, anything missing stays "unknown".
    amenities: found.length ? found : undefined,
  };
}

/** Places raw listings on the map, within the requested region. */
export async function locate(
  raws: RawListing[],
  ext: Pick<SiteExtension, "scope">,
  args: Pick<SearchArgs, "city" | "region">,
  src: SourceMeta,
): Promise<Listing[]> {
  const { city, region } = args;
  const box = padBBox(region.bbox, 1500);
  const geocoded = new Map<string, LatLng | null>();
  const out: Listing[] = [];
  for (const r of raws) {
    if (!isHome(r)) continue;
    if (r.cityName && !sameName(r.cityName, city.name)) continue; // another city
    if (r.geo) {
      out.push(toListing(r, src, r.geo, false)); // the server drops those outside the region
      continue;
    }
    // No coordinates: in a whole-city search, keep only those claiming to be in this neighborhood.
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

/** Turns an extension into a listing source the server knows how to use. */
export function extensionSource(ext: SiteExtension, meta: Partial<SourceMeta> & { site?: string } = {}): SourceAdapter {
  const src: SourceMeta = { id: meta.id ?? ext.id, label: meta.label ?? ext.label };
  return {
    id: src.id,
    label: src.label,
    async search(args) {
      const ctx = { city: args.city, region: args.region, filters: args.filters, site: meta.site };
      const raws = await collectRaw(ext, ctx, ext.scope === "city" ? Infinity : args.max);
      const listings = await locate(raws, ext, args, src);
      args.log(t.sources.listingsFound(src.label, args.region.name, listings.length));
      return listings;
    },
  };
}
