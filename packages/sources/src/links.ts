import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import type { BBox, LatLng, Listing, ListingSource } from "@homematch/contracts";
import { padBBox, safeExternalUrl } from "@homematch/domain";
import { BROWSER_UA, HOUR, cached, httpFetch, readTextLimited } from "./http.js";
import { assertPublicUrl } from "./net.js";
import { detectAmenities, firstInt, normalizeType, parseBRL } from "./listings/normalize.js";
import { geocodeInBox, searchAddress } from "./osm/nominatim.js";

/**
 * "Meus links": recebe a URL de um anúncio (qualquer site) e tenta descobrir onde fica.
 * 1) coordenada do schema.org (JSON-LD `geo`) ou de meta tags — exata;
 * 2) senão, endereço (JSON-LD `address` ou breadcrumb) geocodificado no Nominatim — aproximada.
 */
export interface ExtractedInfo {
  title?: string;
  rent?: number;
  condo?: number;
  iptu?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  image?: string;
  geo?: LatLng;
  address?: string;
  /** Comodidades achadas na descrição; undefined quando a página não tem descrição. */
  amenities?: string[];
}

type Json = Record<string, unknown>;

function* walk(v: unknown): Generator<Json> {
  if (Array.isArray(v)) for (const x of v) yield* walk(x);
  else if (v && typeof v === "object") {
    yield v as Json;
    for (const x of Object.values(v as Json)) if (x && typeof x === "object") yield* walk(x);
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function validGeo(lat?: number, lng?: number): LatLng | undefined {
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

/** Parse puro do HTML de um anúncio. */
export function extractListingInfo(html: string, pageUrl: string): ExtractedInfo {
  const { document } = parseHTML(html);
  const meta = (k: string) =>
    document.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute("content")?.trim() || undefined;
  const info: ExtractedInfo = {};
  let breadcrumb: string[] = [];
  const descriptions: string[] = [];

  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(s.textContent ?? "");
    } catch {
      continue;
    }
    for (const o of walk(data)) {
      const type = String(o["@type"] ?? "");
      if (type === "BreadcrumbList" && Array.isArray(o.itemListElement)) {
        breadcrumb = (o.itemListElement as Json[])
          .map((it) => String((it.item as Json | undefined)?.name ?? it.name ?? ""))
          .filter(Boolean);
        continue;
      }
      if (typeof o.description === "string") descriptions.push(o.description);
      if (Array.isArray(o.amenityFeature)) {
        for (const a of o.amenityFeature as Json[])
          if (a && typeof a.name === "string" && a.value !== false) descriptions.push(a.name);
      }
      const g = o.geo as Json | undefined;
      if (!info.geo && g) info.geo = validGeo(num(g.latitude), num(g.longitude));
      const a = o.address as Json | undefined;
      if (!info.address && a && typeof a === "object" && (a.streetAddress || a.addressLocality)) {
        info.address = [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).join(", ");
      }
      const offers = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Json | undefined;
      info.rent ??= num(offers?.price) ?? (type === "Product" ? num(o.price) : undefined);
      info.bedrooms ??= num(o.numberOfBedrooms) ?? num(o.numberOfRooms);
      info.bathrooms ??= num(o.numberOfBathroomsTotal) ?? num(o.numberOfFullBathrooms);
      info.area ??= num((o.floorSize as Json | undefined)?.value);
      if (!info.title && typeof o.name === "string" && /para alugar|aluguel|quarto|m²/i.test(o.name))
        info.title = o.name;
      if (!info.image && o.image) {
        const img = Array.isArray(o.image) ? o.image[0] : o.image;
        if (typeof img === "string") info.image = img;
      }
    }
  }

  // Meta tags de geolocalização (alguns sites usam em vez do JSON-LD).
  info.geo ??= validGeo(
    num(meta("place:location:latitude") ?? meta("og:latitude")),
    num(meta("place:location:longitude") ?? meta("og:longitude")),
  );
  if (!info.geo) {
    const icbm = meta("ICBM") ?? meta("geo.position");
    const m = icbm?.match(/(-?\d+\.\d+)\s*[,;]\s*(-?\d+\.\d+)/);
    if (m) info.geo = validGeo(Number(m[1]), Number(m[2]));
  }
  if (!info.geo) {
    // Mapa embutido do Google (…q=-23.5,-46.6 / center=… / @-23.5,-46.6)
    const m = html.match(/maps[^"'\s]*?(?:[?&](?:q|center|ll)=|@)(-?\d{1,2}\.\d{4,}),\s?(-?\d{1,3}\.\d{4,})/);
    if (m) info.geo = validGeo(Number(m[1]), Number(m[2]));
  }

  const ogTitle = meta("og:title") ?? document.querySelector("title")?.textContent?.trim();
  const desc = meta("og:description") ?? meta("description") ?? "";
  info.title ??= ogTitle?.replace(/\s*[-|]\s*(QuintoAndar|Viva ?Real|ZAP.*|OLX.*|Imovelweb.*)$/i, "");
  const text = `${ogTitle ?? ""} ${desc}`;
  info.rent ??= parseBRL(text.match(/R\$\s*[\d.,]+/)?.[0]) ?? num(pageUrl.match(/-RS(\d+)-/i)?.[1]);
  info.condo ??= parseBRL(text.match(/condom[íi]nio[^R]{0,15}R\$\s*[\d.,]+/i)?.[0]);
  info.iptu ??= parseBRL(text.match(/IPTU[^R]{0,15}R\$\s*[\d.,]+/i)?.[0]);
  info.bedrooms ??= firstInt(text.match(/(\d+)\s*quartos?/i)?.[0] ?? pageUrl.match(/(\d+)-quartos?/i)?.[0]);
  info.area ??= firstInt(text.match(/(\d+)\s*m²/i)?.[0] ?? pageUrl.match(/(\d+)m2/i)?.[0]);
  info.parking ??= firstInt(text.match(/(\d+)\s*vagas?/i)?.[0]);
  if (desc) descriptions.push(desc);
  if (descriptions.length) info.amenities = detectAmenities(`${info.title ?? ""}\n${descriptions.join("\n")}`);
  info.image ??= meta("og:image");
  info.image = safeExternalUrl(info.image, pageUrl);

  // QuintoAndar: o estado da página traz condomínio e custo total ao lado do aluguel.
  if (info.rent) {
    const i = html.indexOf(`"rentPrice":${info.rent}`);
    if (i >= 0) {
      const near = html.slice(i, i + 800);
      info.condo ??= num(near.match(/"condoPrice":(\d+(?:\.\d+)?)/)?.[1]);
      info.iptu ??= num(near.match(/"iptu(?:Price)?":(\d+(?:\.\d+)?)/)?.[1]);
      const total = num(near.match(/"totalCost":(\d+(?:\.\d+)?)/)?.[1]);
      if (total && total > info.rent && !info.iptu)
        info.iptu = Math.max(0, total - info.rent - (info.condo ?? 0)) || undefined;
    }
  }

  if (!info.address && breadcrumb.length > 2) {
    // ex.: Aluguel › SP › São Paulo › Zona Oeste › Pinheiros › Rua Cardeal Arcoverde
    const parts = breadcrumb
      .slice(1)
      .map((n) => n.replace(/^.*\b(para alugar|para venda|à venda|a venda)\s+(em|no|na)\s+/i, "").trim())
      .filter((n) => n && !/^(zona|in[íi]cio|aluguel|venda|im[óo]veis)/i.test(n));
    info.address = parts.reverse().join(", ");
  }
  return info;
}

/**
 * Quando a página bloqueia a leitura, os links do VivaReal/ZAP ainda dizem muito:
 * /imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/
 */
export function infoFromUrl(url: string): (ExtractedInfo & { typeWord?: string; place?: string }) | null {
  const m = new URL(url).pathname.match(
    /\/imovel\/([a-z]+(?:-de-[a-z]+)?)-(?:(\d+)-quartos?-)?(.+?)-(?:com-.+?-)?(\d+)m2-(?:aluguel|venda)-RS(\d+)-id-\d+/i,
  );
  if (!m) return null;
  const place = m[3]!
    .replace(/-zona-(norte|sul|leste|oeste|central)/i, "")
    .replace(/-/g, " ")
    .trim();
  return {
    typeWord: m[1]!.replace(/-/g, " "),
    bedrooms: m[2] ? Number(m[2]) : undefined,
    area: Number(m[4]),
    rent: Number(m[5]),
    place,
    address: place,
  };
}

export function sourceOf(url: string): ListingSource {
  const h = new URL(url).hostname;
  if (h.endsWith("quintoandar.com.br")) return "quintoandar";
  if (h.endsWith("vivareal.com.br")) return "vivareal";
  return "outro";
}

function listingId(url: string, src: ListingSource): string {
  const id = url.match(/\/imovel\/(\d+)/)?.[1] ?? url.match(/id-(\d+)/)?.[1];
  if (id) return `${src}:${id}`;
  const u = new URL(url);
  return `${src}:${createHash("sha1")
    .update(u.host + u.pathname)
    .digest("hex")
    .slice(0, 12)}`;
}

/** Página de anúncio maior que isso não é anúncio (ou é um arquivo colado por engano). */
const MAX_PAGE_BYTES = 5_000_000;

/**
 * Baixa uma URL colada pelo usuário seguindo os redirecionamentos um a um, conferindo cada destino. O IP de cada
 * conexão é conferido pelo `httpFetch` (`net.ts`), então nenhum caminho chega à rede local.
 */
async function fetchPublic(raw: string, maxRedirects = 5): Promise<{ res: Response; finalUrl: string }> {
  let url = assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await httpFetch(url.toString(), {
      minIntervalMs: 1500,
      retries: 1,
      redirect: "manual",
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "text/html" },
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) return { res, finalUrl: url.toString() };
    await res.body?.cancel();
    if (hop >= maxRedirects) throw new Error("redirecionamentos demais");
    url = assertPublicUrl(new URL(loc, url).toString());
  }
}

export async function resolveLink(rawUrl: string, cityBox?: BBox): Promise<Listing> {
  const url = assertPublicUrl(rawUrl).toString();
  let page: { finalUrl: string; html: string };
  let info: ExtractedInfo;
  let blocked: string | undefined;
  try {
    page = await cached("links", url, 12 * HOUR, async () => {
      const { res, finalUrl } = await fetchPublic(url);
      if (!res.ok) throw new Error(`o site respondeu ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (type && !/html|xml|text\/plain/i.test(type))
        throw new Error(`o link não é uma página (${type.split(";")[0]})`);
      return { finalUrl, html: await readTextLimited(res, MAX_PAGE_BYTES) };
    });
    info = extractListingInfo(page.html, page.finalUrl);
  } catch (e) {
    // Página bloqueada/fora do ar: tenta o que dá para tirar do próprio link.
    const fromUrl = infoFromUrl(url);
    if (!fromUrl) throw e;
    blocked = (e as Error).message;
    page = { finalUrl: url, html: "" };
    info = { ...fromUrl, title: `${fromUrl.typeWord ?? "Imóvel"} em ${fromUrl.place}` };
  }

  let pos = info.geo;
  let approx = false;
  if (!pos && info.address) {
    approx = true;
    pos =
      (cityBox ? await geocodeInBox(info.address, padBBox(cityBox, 20_000)) : null) ??
      (await searchAddress(info.address)
        .then((r) => (r[0] ? { lat: r[0].lat, lng: r[0].lng } : undefined))
        .catch(() => undefined)) ??
      undefined;
  }
  if (!pos) throw new Error("não achei a localização na página (sem coordenada nem endereço)");

  const src = sourceOf(page.finalUrl);
  const title = info.title ?? "Imóvel";
  const rent = info.rent ?? 0;
  return {
    id: listingId(page.finalUrl, src),
    source: src,
    url,
    title,
    type: normalizeType(`${title} ${page.finalUrl}`),
    typeLabel: (title.split(/\s+(com|para|à|em)\s+/i)[0] ?? "Imóvel").replace(/^./, (c) => c.toUpperCase()),
    rent,
    total: rent + (info.condo ?? 0) + (info.iptu ?? 0),
    condo: info.condo,
    iptu: info.iptu,
    area: info.area,
    bedrooms: info.bedrooms,
    bathrooms: info.bathrooms,
    parking: info.parking,
    address: blocked ? `${info.address} (bairro — ${blocked}; dados tirados do link)` : info.address,
    lat: pos.lat,
    lng: pos.lng,
    approxLocation: approx,
    image: info.image,
    amenities: info.amenities,
  };
}
