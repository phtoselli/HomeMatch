import type { City, SourceInfo, SourcesResult } from "@homematch/contracts";
import { inMultiPolygon } from "@homematch/domain";
import { DAY, cacheGet, cacheSet } from "../http.js";
import { bboxQL, overpass } from "../osm/overpass.js";
import { RobotsDisallowedError, extensionSource, fetchPage } from "./core/engine.js";
import { allowedByRobots } from "./core/robots.js";
import { parseSchemaOrgListings } from "./core/schemaorg.js";
import { agencyExtension, type AgencySite } from "./extensions/agency.js";
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
  ["Imoview", /imoview/i],
  ["Sites do Mercado", /sitesdomercado/i],
  ["Jetimob", /jetimob/i],
  ["Tecimob", /tecimob/i],
  ["Imobibrasil", /imobibrasil/i],
  ["Vista", /vistasoft|vistahost|vistaimoveis/i],
  ["Union", /unionsistemas|union\.com\.br/i],
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

/** Pure parsing: link to the rentals page on the site's home (the shortest, most list-like one). */
export function findRentalLink(html: string, base: string): string | null {
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
  const score = (s: string) =>
    (/imove/i.test(s) ? 0 : 5) + new URL(s).pathname.split("/").filter(Boolean).length * 2 + s.length / 100;
  return [...cands].sort((a, b) => score(a) - score(b))[0] ?? null;
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

type Inspected = SourceInfo & { listingsUrl?: string };

const GUESSES = ["/imoveis/alugar/", "/aluguel/", "/alugar/", "/imoveis/para-alugar", "/locacao/"];

/** Checks whether the agency's website can be read (cached for 7 days). */
/** Cache namespace of inspected agencies (versioned: older entries used other status ids). */
const AGENCY_CACHE = "agency-v2";
const notes = t.sources.agencyNotes;

export async function inspectAgency(a: AgencyPlace): Promise<Inspected> {
  const id = hostId(a.site);
  const hit = await cacheGet<Inspected>(AGENCY_CACHE, id, 7 * DAY);
  if (hit) return hit;
  const base: SourceInfo = { id, label: a.name, kind: "agency", site: a.site, status: "error" };
  const ext = { id, label: a.name, minIntervalMs: 1500 };
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
  const platform = detectPlatform(home);
  const found = findRentalLink(home, a.site);
  const candidates = [
    ...new Set([found, ...GUESSES.map((g) => `${a.site}${g}`)].filter((x): x is string => !!x)),
  ].slice(0, 4);
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
    const n = parseSchemaOrgListings(html, url).length;
    if (n > 0)
      return done({
        ...base,
        status: "ok",
        platform,
        listingsUrl: url,
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

/** Portals (always) + agencies found in the city, with what can be read. */
export async function discoverSources(city: City, log: (m: string) => void = () => {}): Promise<SourcesResult> {
  const portals = portalSources();
  let agencies: SourceInfo[] = [];
  try {
    const places = (await findAgencies(city)).slice(0, 30);
    log(t.sources.agenciesFound(places.length, city.name));
    agencies = (await pool(places, 6, inspectAgency)).map(({ listingsUrl: _u, ...s }) => s);
  } catch (e) {
    log(t.sources.agenciesFailed((e as Error).message));
  }
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
  };
  return extensionSource(agencyExtension(a));
}
