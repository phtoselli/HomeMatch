import { parseHTML } from "linkedom";
import type { AmenityId, LatLng, Listing } from "@homematch/contracts";
import { padBBox } from "@homematch/domain";
import { BROWSER_UA, DAY, HOUR, cached, httpFetch } from "../http.js";
import { geocodeInBox } from "../osm/nominatim.js";
import { detectAmenities, firstInt, normalizeType, parseBRL, slugify } from "./normalize.js";
import { SourceBlockedError, type SourceAdapter } from "./types.js";
import { t } from "@homematch/i18n";

// VivaReal: public search page per neighborhood. Cards carry price, area, bedrooms and street;
// coordinates come from geocoding "street, neighborhood, city" with Nominatim.
const SITE = "https://www.vivareal.com.br";
const PER_PAGE = 30;
const ZONES = ["zona-sul", "zona-oeste", "zona-norte", "zona-leste", "centro"];
const MAX_GEOCODES_PER_REGION = 40;

export interface VrCard {
  id: string;
  url: string;
  title: string;
  typeLabel: string;
  rent: number;
  condo?: number;
  iptu?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  street?: string;
  location?: string; // "Pinheiros, São Paulo"
  image?: string;
  amenities?: AmenityId[];
}

const cy = (el: Element, name: string) => el.querySelector(`[data-cy="${name}"]`)?.textContent?.trim() ?? "";

/** Pure parsing of a VivaReal search page. */
export function parseVivaReal(html: string): VrCard[] {
  const { document } = parseHTML(html);
  const out: VrCard[] = [];
  for (const card of document.querySelectorAll('li[data-cy="rp-property-cd"]')) {
    const a = card.querySelector("a[href]");
    const href = a?.getAttribute("href") ?? "";
    const id = href.match(/id-(\d+)/)?.[1];
    if (!id) continue;
    const priceTxt = cy(card, "rp-cardProperty-price-txt");
    const rent = parseBRL(priceTxt.split("/")[0]);
    if (!rent) continue; // "price on request" or no price: cannot be filtered
    const title = (a?.getAttribute("title") ?? cy(card, "card-property-content")).replace(/\s+/g, " ").trim();
    const url = new URL(href, SITE);
    url.search = "";
    // The card only has a title/summary: what is found counts, but absence does not mean "does not have".
    const found = detectAmenities(`${title} ${cy(card, "card-property-content")}`);
    out.push({
      id,
      url: url.toString(),
      title,
      typeLabel: title.split(/ para (alugar|venda)/i)[0]!.trim() || t.links.property,
      rent,
      condo: parseBRL(priceTxt.match(/Cond\.\s*R\$\s*[\d.,]+/i)?.[0]),
      iptu: parseBRL(priceTxt.match(/IPTU\s*R\$\s*[\d.,]+/i)?.[0]),
      area: firstInt(cy(card, "rp-cardProperty-propertyArea-txt")),
      bedrooms: firstInt(cy(card, "rp-cardProperty-bedroomQuantity-txt")),
      bathrooms: firstInt(cy(card, "rp-cardProperty-bathroomQuantity-txt")),
      parking: firstInt(cy(card, "rp-cardProperty-parkingSpacesQuantity-txt")),
      street: cy(card, "rp-cardProperty-street-txt") || undefined,
      location: cy(card, "rp-cardProperty-location-txt") || undefined,
      image: card.querySelector("img[src]")?.getAttribute("src") ?? undefined,
      amenities: found.length ? found : undefined,
    });
  }
  return out;
}

/** After a block, wait before trying again (do not insist on every region). */
const BLOCK_COOLDOWN_MS = 15 * 60_000;
let blockedUntil = 0;

async function getPage(url: string): Promise<{ status: number; html: string }> {
  return cached("vivareal", url, 6 * HOUR, async () => {
    if (Date.now() < blockedUntil) {
      throw new SourceBlockedError(t.sources.blockedRecently);
    }
    const res = await httpFetch(url, {
      minIntervalMs: 2000,
      retries: 1,
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    // A block (403/429) is not cached: it is temporary and does not mean "unknown neighborhood".
    if (res.status === 403 || res.status === 429) {
      blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
      throw new SourceBlockedError(t.sources.blocked(res.status));
    }
    return { status: res.status, html: res.ok ? await res.text() : "" };
  });
}

/** Finds the neighborhood's search URL (cities with zones, like SP and RJ, use /zona-x/ in the path). */
async function resolveRegionUrl(uf: string, city: string, neighborhood: string): Promise<string | null> {
  const key = `${uf}/${city}/${neighborhood}`;
  return cached("vivareal-url", key, 30 * DAY, async () => {
    const candidates = [
      `${SITE}/aluguel/${uf}/${city}/bairros/${neighborhood}/`,
      ...ZONES.map((z) => `${SITE}/aluguel/${uf}/${city}/${z}/${neighborhood}/`),
    ];
    for (const url of candidates) {
      const { status, html } = await getPage(url);
      if (status === 200 && html.includes("rp-property-cd")) return url;
    }
    return null;
  });
}

/** Stable position near the region center when the address is not found. */
function jitter(center: LatLng, seed: string): LatLng {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * (Math.PI / 180);
  const r = 0.0015 + ((h >>> 9) % 100) / 100000;
  return { lat: center.lat + r * Math.sin(ang), lng: center.lng + r * Math.cos(ang) };
}

export const vivaReal: SourceAdapter = {
  id: "vivareal",
  label: "VivaReal",
  async search({ city, region, max, log }) {
    const uf = (city.stateCode ?? "").toLowerCase();
    const base = await resolveRegionUrl(uf, slugify(city.name), slugify(region.name));
    if (!base) {
      log(t.sources.vivarealNoNeighborhood(region.name));
      return [];
    }
    const cards: VrCard[] = [];
    for (let page = 1; cards.length < max && page <= Math.ceil(max / PER_PAGE); page++) {
      const { status, html } = await getPage(page === 1 ? base : `${base}?pagina=${page}`);
      if (status !== 200) break;
      const got = parseVivaReal(html);
      cards.push(...got);
      log(t.sources.listingsFound("VivaReal", region.name, cards.length));
      if (got.length < PER_PAGE) break;
    }

    const box = padBBox(region.bbox, 1500);
    const geo = new Map<string, LatLng | null>();
    const out: Listing[] = [];
    for (const c of cards.slice(0, max)) {
      let pos: LatLng | null = null;
      if (c.street) {
        const q = `${c.street}, ${c.location ?? `${region.name}, ${city.name}`}`;
        if (!geo.has(q) && geo.size < MAX_GEOCODES_PER_REGION) geo.set(q, await geocodeInBox(q, box));
        pos = geo.get(q) ?? null;
      }
      const p = pos ?? jitter(region, c.id);
      out.push({
        id: `vivareal:${c.id}`,
        source: "vivareal",
        url: c.url,
        title: c.title,
        type: normalizeType(c.typeLabel),
        typeLabel: c.typeLabel,
        rent: c.rent,
        total: c.rent + (c.condo ?? 0) + (c.iptu ?? 0),
        condo: c.condo,
        iptu: c.iptu,
        area: c.area,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        parking: c.parking,
        address: [c.street, c.location].filter(Boolean).join(", "),
        neighbourhood: c.location?.split(",")[0],
        lat: p.lat,
        lng: p.lng,
        approxLocation: !pos,
        image: c.image,
        amenities: c.amenities,
      });
    }
    return out;
  },
};
