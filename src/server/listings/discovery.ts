import type { City, SourceInfo, SourcesResult } from "../../shared/types.js";
import { inMultiPolygon } from "../geo.js";
import { DAY, cacheGet, cacheSet } from "../http.js";
import { bboxQL, overpass } from "../osm/overpass.js";
import { RobotsDisallowedError, extensionSource, fetchPage } from "./core/engine.js";
import { allowedByRobots } from "./core/robots.js";
import { parseSchemaOrgListings } from "./core/schemaorg.js";
import { agencyExtension, type AgencySite } from "./extensions/agency.js";
import { PORTALS } from "./portals.js";
import { SourceBlockedError, type SourceAdapter } from "./types.js";

/**
 * Descoberta de imobiliárias na cidade: as que estão no OpenStreetMap (office/shop=estate_agent) com site.
 * Para cada site: respeita o robots.txt, reconhece a plataforma, acha a página de aluguel e vê se os
 * anúncios saem no formato padrão (schema.org). Os que dão para ler viram fonte de anúncios.
 */

export interface AgencyPlace {
  name: string;
  site: string;
}

/** Plataformas de site de imobiliária reconhecidas pela assinatura no HTML. */
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

const RENT = /(alug|loca(c|ç|%c3%a7)(a|ã|%c3%a3)o|locacao)/i;
const NOT_LISTINGS = /(como-|administra|anuncie|anunciar|cadastr|seu-imovel|blog|contato|fale|financ|quem-somos|sobre|trabalhe|propriet|whatsapp|wa\.me|\.pdf|politica|termos|simulador|garantia|seguro|documentos)/i;

/** Parse puro: link da página de aluguel na home do site (o mais curto e mais "de lista"). */
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
  const score = (s: string) => (/imove/i.test(s) ? 0 : 5) + new URL(s).pathname.split("/").filter(Boolean).length * 2 + s.length / 100;
  return [...cands].sort((a, b) => score(a) - score(b))[0] ?? null;
}

const hostId = (site: string) => `site:${new URL(site).hostname.replace(/^www\./, "")}`;

/** Imobiliárias com site no OpenStreetMap, dentro da cidade. */
export async function findAgencies(city: City): Promise<AgencyPlace[]> {
  const q = `[out:json][timeout:60];(nwr["office"="estate_agent"](${bboxQL(city.bbox)});nwr["shop"="estate_agent"](${bboxQL(city.bbox)}););out center tags;`;
  const res = await overpass(q);
  const byHost = new Map<string, AgencyPlace>();
  for (const e of res.elements) {
    const t = e.tags ?? {};
    const raw = t.website ?? t["contact:website"] ?? t.url;
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
    // Portais e redes nacionais já têm extensão própria (ou não têm lista por cidade no site da rede).
    if (PORTALS.some((p) => host.endsWith(new URL(p.home).hostname.replace(/^www\./, "")))) continue;
    if (!byHost.has(host)) byHost.set(host, { name: t.name ?? host, site });
  }
  return [...byHost.values()];
}

type Inspected = SourceInfo & { listingsUrl?: string };

const GUESSES = ["/imoveis/alugar/", "/aluguel/", "/alugar/", "/imoveis/para-alugar", "/locacao/"];

/** Vê se dá para ler o site da imobiliária (com cache de 7 dias). */
export async function inspectAgency(a: AgencyPlace): Promise<Inspected> {
  const id = hostId(a.site);
  const hit = await cacheGet<Inspected>("agency", id, 7 * DAY);
  if (hit) return hit;
  const base: SourceInfo = { id, label: a.name, kind: "imobiliaria", site: a.site, status: "erro" };
  const ext = { id, label: a.name, minIntervalMs: 1500 };
  const done = async (r: Inspected, keep = true) => {
    if (keep) await cacheSet("agency", id, r);
    return r;
  };
  let home: string;
  try {
    home = await fetchPage(ext, `${a.site}/`);
  } catch (e) {
    if (e instanceof RobotsDisallowedError) return done({ ...base, status: "robots", note: "O site pede para robôs não lerem (robots.txt). Respeitamos." });
    if (e instanceof SourceBlockedError) return done({ ...base, status: "bloqueado", note: "O site barra leitura automática." }, false);
    return done({ ...base, status: "erro", note: "O site não respondeu agora." }, false);
  }
  const platform = detectPlatform(home);
  const found = findRentalLink(home, a.site);
  const candidates = [...new Set([found, ...GUESSES.map((g) => `${a.site}${g}`)].filter((x): x is string => !!x))].slice(0, 4);
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
    if (n > 0) return done({ ...base, status: "ok", platform, listingsUrl: url, note: `${n} anúncios de aluguel na primeira página.` });
    if (url === found) break; // achou a página de aluguel, mas sem dados legíveis: não chuta outras
  }
  if (robotsHit && !found) return done({ ...base, status: "robots", platform, note: "O site pede para robôs não lerem a página de aluguel (robots.txt)." });
  return done({
    ...base,
    status: "sem-dados",
    platform,
    note: found
      ? `A página de aluguel não traz os anúncios num formato padrão: falta uma extensão${platform ? ` para ${platform}` : " para este site"}.`
      : "Não achamos a página de aluguel no site.",
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

/** Portais (sempre) + imobiliárias achadas na cidade, com o que dá para ler. */
export async function discoverSources(city: City, log: (m: string) => void = () => {}): Promise<SourcesResult> {
  const portals = portalSources();
  let agencies: SourceInfo[] = [];
  try {
    const places = (await findAgencies(city)).slice(0, 30);
    log(`${places.length} imobiliárias com site em ${city.name} no OpenStreetMap. Vendo quais dá para ler…`);
    agencies = (await pool(places, 6, inspectAgency)).map(({ listingsUrl: _u, ...s }) => s);
  } catch (e) {
    log(`Não deu para buscar as imobiliárias da cidade: ${(e as Error).message}`);
  }
  const order = { ok: 0, "sem-dados": 1, robots: 2, bloqueado: 3, erro: 4 } as const;
  agencies.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label));
  return { city: city.name, portals, agencies };
}

/** Fonte de anúncios para uma imobiliária descoberta ("site:host"), se der para ler. */
export async function agencySource(id: string): Promise<SourceAdapter | null> {
  const info = await cacheGet<Inspected>("agency", id, 30 * DAY);
  if (!info || info.status !== "ok" || !info.listingsUrl) return null;
  const a: AgencySite = { id, label: info.label, site: info.site, listingsUrl: info.listingsUrl, platform: info.platform };
  return extensionSource(agencyExtension(a));
}
