import type { City, SourceInfo, SourcesResult } from "@homematch/contracts";
import { inMultiPolygon } from "@homematch/domain";
import { DAY, cacheGet, cacheSet } from "../http.js";
import { bboxQL, overpass } from "../osm/overpass.js";
import { RobotsDisallowedError, extensionSource, fetchPage } from "./core/engine.js";
import { allowedByRobots } from "./core/robots.js";
import { isDetailPage } from "./core/cards.js";
import { agencyExtension, parseAgencyPage, type AgencySite } from "./extensions/agency.js";
import { knownAgencies } from "./agencies-known.js";
import { slugify } from "./normalize.js";
import { PORTALS } from "./portals.js";
import { SourceBlockedError, type SourceAdapter } from "./types.js";
import { t } from "@homematch/i18n";

/**
 * Discovery of real estate agencies in the city: those in OpenStreetMap (office/shop=estate_agent) with a website.
 * For each site: respect robots.txt, recognize the platform, find the rentals page and check whether listings come
 * in the standard format (schema.org). Readable ones become listing sources.
 */

export interface AgencyPlace {
  name: string;
  site: string;
}

/** Agency website platforms recognized by their signature in the HTML. */
const PLATFORMS: [string, RegExp][] = [
  ["Kenlo", /kenlo\.io|ingaiasites|valuegaia/i],
  ["FlipCRM", /flipcrm|flip-prod-fotos/i],
  ["Arbo", /arboimoveis/i],
  ["Imobzi", /imobzi/i],
  ["Keyspot", /keyspot/i],
  ["Imoview", /imoview/i],
  ["Sites do Mercado", /sitesdomercado/i],
  ["Jetimob", /jetimob/i],
  ["Tecimob", /tecimob/i],
  ["Imobibrasil", /imobibrasil/i],
  ["Vista", /vistasoft|vistahost|vistaimoveis/i],
  ["Union", /unionsistemas|union\.com\.br/i],
  ["Tokko", /tokkobroker/i],
  ["Smartimob", /smtximob|smartimob/i],
  ["WordPress", /wp-content\//i],
  ["Next.js", /\/_next\/static\//i],
];

export function detectPlatform(html: string): string | undefined {
  return PLATFORMS.find(([, re]) => re.test(html))?.[0];
}

/** "Rent" in Brazilian URLs and link texts ("aluguel", "locação"). */
const RENT = /(alug|loca(c|ç|%c3%a7)(a|ã|%c3%a3)o|locacao)/i;
const NOT_LISTINGS =
  /(como-|administra|anuncie|anunciar|cadastr|seu-imovel|blog|contato|fale|financ|quem-somos|sobre|trabalhe|propriet|whatsapp|wa\.me|\.pdf|politica|termos|simulador|garantia|seguro|documentos)/i;

/** Prefer list pages (rental links on agency homes are mostly featured properties, not the search page), with "imóveis"/"buscar" in the path, short, and for the city when it is named. */
function rentalScore(u: string, citySlug?: string): number {
  const path = decodeURIComponent(new URL(u).pathname + new URL(u).search).toLowerCase();
  return (
    (isDetailPage(u) ? 100 : 0) +
    (/(imove|busca|alugar|aluguel|locacao)/.test(path) ? 0 : 5) +
    (citySlug && !path.includes(citySlug) ? 3 : 0) +
    path.split("/").filter(Boolean).length * 2 +
    u.length / 100
  );
}

/** Pure parsing: link to the rentals page on the site's home (the shortest, most list-like one). */
export function findRentalLink(html: string, base: string, citySlug?: string): string | null {
  const origin = new URL(base).origin;
  const cands = new Set<string>();
  for (const m of html.matchAll(/\bhref=["']?([^"' >]+)/gi)) {
    let u: URL;
    try {
      u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    const path = decodeURIComponent(u.pathname + u.search).toLowerCase();
    if (!RENT.test(path) || NOT_LISTINGS.test(path)) continue;
    u.hash = "";
    cands.add(u.toString());
  }
  const best = [...cands].sort((a, b) => rentalScore(a, citySlug) - rentalScore(b, citySlug))[0];
  // Only featured properties on the home: no search page found here (the sitemap may have it).
  return best && !isDetailPage(best) ? best : null;
}

/** A rentals list page per neighborhood, as the site's sitemap lists them. */
export interface RegionPage {
  /** Neighborhood as it appears in the link ("parque-taquaral" → "parque taquaral"). */
  name: string;
  url: string;
}

/**
 * Pure parsing of sitemap URLs: the city's rentals list page (shortest list-like rent URL naming the city) and the
 * per-neighborhood ones under it ("/buscar/locacao/campinas-sp-brasil/taquaral",
 * "/imoveis/para-alugar/taquaral-campinas-sp"). Pages per property type are left out.
 */
export function rentalPagesFromUrls(urls: string[], citySlug: string): { city?: string; regions: RegionPage[] } {
  const lists = urls.filter((u) => {
    try {
      const p = decodeURIComponent(new URL(u).pathname).toLowerCase();
      return RENT.test(p) && !NOT_LISTINGS.test(p) && !/(venda|comprar)/.test(p) && !isDetailPage(u);
    } catch {
      return false;
    }
  });
  const inCity = lists.filter((u) => new URL(u).pathname.toLowerCase().includes(citySlug));
  const city = inCity.sort((a, b) => a.length - b.length)[0];
  if (!city) return { regions: [] };
  const cityPath = new URL(city).pathname.replace(/\/$/, "");
  const prefix = cityPath.slice(0, cityPath.lastIndexOf("/"));
  const TYPES =
    /(^|\/)(apartamento|casa|casas|kitnet|studio|sobrado|terreno|sala|predio|galpao|loja|chacara|cobertura|flat|comercial|rural|barracao)s?(\/|$)/;
  const regions: RegionPage[] = [];
  for (const u of inCity) {
    if (u === city) continue;
    const path = new URL(u).pathname.replace(/\/$/, "");
    if (TYPES.test(path.slice(prefix.length))) continue;
    let slug: string | undefined;
    // ".../campinas-sp-brasil/taquaral"
    if (path.startsWith(`${cityPath}/`) && !path.slice(cityPath.length + 1).includes("/"))
      slug = path.slice(cityPath.length + 1);
    // ".../para-alugar/taquaral-campinas-sp" next to ".../para-alugar/campinas-sp"
    else if (path.startsWith(`${prefix}/`) && path.endsWith(cityPath.slice(prefix.length + 1))) {
      const seg = path.slice(prefix.length + 1);
      slug = seg.slice(0, seg.length - cityPath.slice(prefix.length + 1).length).replace(/-$/, "");
    }
    if (slug) regions.push({ name: slug.replace(/-/g, " "), url: u });
  }
  return { city, regions: regions.slice(0, 400) };
}

/** URLs in the site's sitemaps (robots.txt `Sitemap:` or /sitemap.xml), following an index a few levels. */
async function sitemapUrls(ext: { id: string; label: string; minIntervalMs?: number }, site: string, citySlug: string) {
  const urls: string[] = [];
  let queue = [`${site}/sitemap.xml`];
  try {
    const robots = await fetchPage(ext, `${site}/robots.txt`);
    const listed = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
    if (listed.length) queue = listed;
  } catch {
    /* no robots.txt: try /sitemap.xml */
  }
  for (let fetched = 0; queue.length && fetched < 6; fetched++) {
    const url = queue.shift()!;
    let xml: string;
    try {
      xml = await fetchPage(ext, url);
    } catch {
      continue;
    }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(xml)) {
      // Child sitemaps: the city's and the "pages"/"routes" ones first, property-by-property ones last.
      const score = (u: string) =>
        (u.toLowerCase().includes(citySlug) ? 0 : 2) +
        (/(page|rout|categor|busca|search|1\.xml)/i.test(u) ? 0 : 1) +
        (/(propert|imove|listing)/i.test(u) ? 2 : 0);
      queue.push(...locs.sort((a, b) => score(a) - score(b)));
    } else urls.push(...locs);
  }
  return urls;
}

const hostId = (site: string) => `site:${new URL(site).hostname.replace(/^www\./, "")}`;

/** Agencies with a website in OpenStreetMap, within the city. */
export async function findAgencies(city: City): Promise<AgencyPlace[]> {
  const q = `[out:json][timeout:60];(nwr["office"="estate_agent"](${bboxQL(city.bbox)});nwr["shop"="estate_agent"](${bboxQL(city.bbox)}););out center tags;`;
  const res = await overpass(q);
  const byHost = new Map<string, AgencyPlace>();
  for (const e of res.elements) {
    const tags = e.tags ?? {};
    const raw = tags.website ?? tags["contact:website"] ?? tags.url;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!raw || lat == null || lon == null) continue;
    if (city.boundary && !inMultiPolygon({ lat, lng: lon }, city.boundary)) continue;
    let site: string;
    try {
      site = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`).origin;
    } catch {
      continue;
    }
    const host = new URL(site).hostname.replace(/^www\./, "");
    // Portals and national networks already have their own extension (or no per-city list on the network's site).
    if (PORTALS.some((p) => host.endsWith(new URL(p.home).hostname.replace(/^www\./, "")))) continue;
    if (!byHost.has(host)) byHost.set(host, { name: tags.name ?? host, site });
  }
  return [...byHost.values()];
}

type Inspected = SourceInfo & { listingsUrl?: string; regionPages?: RegionPage[] };

const GUESSES = ["/imoveis/alugar/", "/aluguel/", "/alugar/", "/imoveis/para-alugar", "/locacao/", "/buscar/locacao"];
/** The city's rentals page as common platforms build it (Union, Arbo, FlipCRM…). */
const CITY_GUESSES = (city: string, uf: string) => [
  `/alugar/${uf}/${city}`,
  `/imoveis/para-alugar/${city}-${uf}`,
  `/buscar/locacao/${city}-${uf}-brasil`,
  `/aluguel/${city}`,
];

/** Cache namespace of inspected agencies (versioned: v3 reads the app state and keeps per-neighborhood pages). */
const AGENCY_CACHE = "agency-v3";
const notes = t.sources.agencyNotes;

/** The agency's name from its home page (for sites the user added), without the slogan after a separator. */
export function siteName(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const name = (og ?? title)
    ?.replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .split(/\s[|–—-]\s/)[0]
    ?.trim();
  return name && name.length <= 60 ? name : undefined;
}

/** Checks whether the agency's website can be read (cached for 7 days). */
export async function inspectAgency(a: AgencyPlace, city?: Pick<City, "name" | "stateCode">): Promise<Inspected> {
  const id = hostId(a.site);
  const hit = await cacheGet<Inspected>(AGENCY_CACHE, id, 7 * DAY);
  if (hit) return hit;
  const ext = { id, label: a.name, minIntervalMs: 1500 };
  let base: SourceInfo = { id, label: a.name, kind: "agency", site: a.site, status: "error" };
  const done = async (r: Inspected, keep = true) => {
    if (keep) await cacheSet(AGENCY_CACHE, id, r);
    return r;
  };
  let home: string;
  try {
    home = await fetchPage(ext, `${a.site}/`);
  } catch (e) {
    if (e instanceof RobotsDisallowedError) return done({ ...base, status: "robots", note: notes.robots });
    if (e instanceof SourceBlockedError) return done({ ...base, status: "blocked", note: notes.blocked }, false);
    return done({ ...base, status: "error", note: notes.down }, false);
  }
  if (a.name === new URL(a.site).hostname.replace(/^www\./, "")) base = { ...base, label: siteName(home) ?? a.name };
  const platform = detectPlatform(home);
  const citySlug = city ? slugify(city.name) : undefined;
  const uf = city?.stateCode?.toLowerCase();
  // The city's rentals page and its per-neighborhood pages, from the sitemap (more than the first page of results).
  const fromSitemap = citySlug ? rentalPagesFromUrls(await sitemapUrls(ext, a.site, citySlug), citySlug) : undefined;
  const found = findRentalLink(home, a.site, citySlug);
  const candidates = [
    ...new Set(
      [
        fromSitemap?.city,
        found,
        ...(citySlug && uf ? CITY_GUESSES(citySlug, uf) : []).map((g) => `${a.site}${g}`),
        ...GUESSES.map((g) => `${a.site}${g}`),
      ].filter((x): x is string => !!x),
    ),
  ].slice(0, 8);
  let robotsHit = false;
  for (const url of candidates) {
    if (!(await allowedByRobots(url))) {
      robotsHit = true;
      continue;
    }
    let html: string;
    try {
      html = await fetchPage(ext, url);
    } catch {
      continue;
    }
    const n = parseAgencyPage(html, url).length;
    if (n > 0)
      return done({
        ...base,
        status: "ok",
        platform,
        listingsUrl: url,
        regionPages: url === fromSitemap?.city ? fromSitemap.regions : undefined,
        note: notes.readable(n),
      });
    if (url === found) break; // found the rentals page, but no readable data: do not guess others
  }
  if (robotsHit && !found)
    return done({
      ...base,
      status: "robots",
      platform,
      note: notes.robotsRentals,
    });
  return done({
    ...base,
    status: "no-data",
    platform,
    note: found ? notes.noStandardFormat(platform) : notes.noRentalsPage,
  });
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

export const portalSources = (): SourceInfo[] =>
  PORTALS.map((p) => ({ id: p.id, label: p.label, kind: "portal", site: p.home, status: "ok", note: p.note }));

/** An agency website typed by the user: its origin, or null when it is not a public http(s) site. */
export function agencyFromUrl(raw: string): AgencyPlace | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return { name: u.hostname.replace(/^www\./, ""), site: u.origin };
  } catch {
    return null;
  }
}

/**
 * Portals (always) + the city's agencies, with what can be read: the ones the user added, the ones known for the
 * city (agencies-known.ts) and the ones in OpenStreetMap.
 */
export async function discoverSources(
  city: City,
  log: (m: string) => void = () => {},
  extra: string[] = [],
): Promise<SourcesResult> {
  const portals = portalSources();
  let agencies: SourceInfo[] = [];
  const byHost = new Map<string, AgencyPlace>();
  const addAll = (list: AgencyPlace[]) => {
    for (const p of list) {
      const host = new URL(p.site).hostname.replace(/^www\./, "");
      if (!byHost.has(host)) byHost.set(host, p);
    }
  };
  addAll(extra.map(agencyFromUrl).filter((x): x is AgencyPlace => !!x));
  addAll(knownAgencies(city));
  try {
    addAll(await findAgencies(city));
  } catch (e) {
    log(t.sources.agenciesFailed((e as Error).message));
  }
  const places = [...byHost.values()].slice(0, 40);
  log(t.sources.agenciesFound(places.length, city.name));
  agencies = (await pool(places, 6, (p) => inspectAgency(p, city))).map(
    ({ listingsUrl: _u, regionPages: _r, ...s }) => s,
  );
  const order = { ok: 0, "no-data": 1, robots: 2, blocked: 3, error: 4 } as const;
  agencies.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label));
  return { city: city.name, portals, agencies };
}

/** Listing source for a discovered agency ("site:host"), when it can be read. */
export async function agencySource(id: string): Promise<SourceAdapter | null> {
  const info = await cacheGet<Inspected>(AGENCY_CACHE, id, 30 * DAY);
  if (!info || info.status !== "ok" || !info.listingsUrl) return null;
  const a: AgencySite = {
    id,
    label: info.label,
    site: info.site,
    listingsUrl: info.listingsUrl,
    platform: info.platform,
    regionPages: info.regionPages,
  };
  return extensionSource(agencyExtension(a));
}
