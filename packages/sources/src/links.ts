import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import type { AmenityId, BBox, LatLng, Listing, ListingSource } from "@homematch/contracts";
import { padBBox, safeExternalUrl } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { BROWSER_UA, HOUR, cached, httpFetch, readTextLimited } from "./http.js";
import { assertPublicUrl } from "./net.js";
import { detectAmenities, firstInt, normalizeType, parseBRL } from "./listings/normalize.js";
import { geocodeInBox, searchAddress } from "./osm/nominatim.js";
import {
  addressInText,
  appStates,
  listingFromState,
  mainHtml,
  num,
  validGeo,
  walkSchema as walk,
  type Json,
} from "./listing-location.js";

/**
 * Pasted links: takes a listing URL (any site) and tries to find where the property is.
 * 1) the property's coordinates: schema.org (JSON-LD `geo`) of the listing, the page's app state (Next.js, Nuxt…),
 *    meta tags or a map embedded in the page body — exact;
 * 2) otherwise, the property's address (JSON-LD, app state, an address written in the page body, breadcrumb)
 *    geocoded with Nominatim — approximate.
 * Never the agency's own address: schema.org organizations (RealEstateAgent…), the offices in the app state and the
 * page header/footer are skipped (listing-location.ts).
 * Text patterns match Brazilian listing pages (Portuguese), which is the data being parsed.
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
  /** Amenities found in the description; undefined when the page has no description. */
  amenities?: AmenityId[];
}

/** Pure parsing of a listing's HTML. */
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

  // The listing in the page's app state (agency sites on Next.js/Nuxt: often the only place with its position).
  const state = listingFromState(appStates(document as unknown as Document, html));
  info.geo ??= state.geo;
  const body = mainHtml(document as unknown as Document);

  // Geolocation meta tags (some sites use them instead of JSON-LD).
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
    // Map embedded in the page body (…q=-23.5,-46.6 / center=… / @-23.5,-46.6), not the footer's office map.
    const m = body.match(/maps[^"'\s]*?(?:[?&](?:q|center|ll)=|@)(-?\d{1,2}\.\d{4,}),\s?(-?\d{1,3}\.\d{4,})/);
    if (m) info.geo = validGeo(Number(m[1]), Number(m[2]));
  }

  const ogTitle = meta("og:title") ?? document.querySelector("title")?.textContent?.trim();
  const desc = meta("og:description") ?? meta("description") ?? "";
  info.title ??= ogTitle?.replace(/\s*[-|]\s*(QuintoAndar|Viva ?Real|ZAP.*|OLX.*|Imovelweb.*)$/i, "");
  const text = `${ogTitle ?? ""} ${info.title ?? ""} ${desc}`;
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

  // QuintoAndar: the page state has the condo fee and total cost next to the rent.
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

  info.address ??= state.address ?? addressInText(body);
  if (!info.address && breadcrumb.length > 2) {
    // e.g. Aluguel › SP › São Paulo › Zona Oeste › Pinheiros › Rua Cardeal Arcoverde
    const parts = breadcrumb
      .slice(1)
      .map((n) => n.replace(/^.*\b(para alugar|para venda|à venda|a venda)\s+(em|no|na)\s+/i, "").trim())
      .filter((n) => n && !/^(zona|in[íi]cio|aluguel|venda|im[óo]veis)/i.test(n));
    info.address = parts.reverse().join(", ");
  }
  return info;
}

/**
 * When the page blocks reading, VivaReal/ZAP links still say a lot:
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
  return "other";
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

/** A "listing page" larger than this is not one (or is a file pasted by mistake). */
const MAX_PAGE_BYTES = 5_000_000;

/**
 * Downloads a URL pasted by the user, following redirects one by one and checking each target. Each connection's
 * IP is checked by `httpFetch` (`net.ts`), so no path reaches the local network.
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
    if (hop >= maxRedirects) throw new Error(t.links.tooManyRedirects);
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
      if (!res.ok) throw new Error(t.links.siteStatus(res.status));
      const type = res.headers.get("content-type") ?? "";
      if (type && !/html|xml|text\/plain/i.test(type)) throw new Error(t.links.notAPage(type.split(";")[0]!));
      return { finalUrl, html: await readTextLimited(res, MAX_PAGE_BYTES) };
    });
    info = extractListingInfo(page.html, page.finalUrl);
  } catch (e) {
    // Page blocked or down: use what the link itself tells.
    const fromUrl = infoFromUrl(url);
    if (!fromUrl) throw e;
    blocked = (e as Error).message;
    page = { finalUrl: url, html: "" };
    info = { ...fromUrl, title: t.links.titleFromUrl(fromUrl.typeWord ?? t.links.property, fromUrl.place ?? "") };
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
  if (!pos) throw new Error(t.links.noLocation);

  const src = sourceOf(page.finalUrl);
  const title = info.title ?? t.links.property;
  const rent = info.rent ?? 0;
  return {
    id: listingId(page.finalUrl, src),
    source: src,
    url,
    title,
    type: normalizeType(`${title} ${page.finalUrl}`),
    typeLabel: (title.split(/\s+(com|para|à|em)\s+/i)[0] ?? t.links.property).replace(/^./, (c) => c.toUpperCase()),
    rent,
    total: rent + (info.condo ?? 0) + (info.iptu ?? 0),
    condo: info.condo,
    iptu: info.iptu,
    area: info.area,
    bedrooms: info.bedrooms,
    bathrooms: info.bathrooms,
    parking: info.parking,
    address: blocked ? t.links.addressFromUrl(info.address ?? "", blocked) : info.address,
    lat: pos.lat,
    lng: pos.lng,
    approxLocation: approx,
    image: info.image,
    amenities: info.amenities,
  };
}
