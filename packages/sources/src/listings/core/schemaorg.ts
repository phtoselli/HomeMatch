import { createHash } from "node:crypto";
import type { LatLng } from "@homematch/contracts";
import { safeExternalUrl } from "@homematch/domain";
import { firstInt, parseBRL } from "../normalize.js";
import type { RawListing } from "./types.js";
import { t } from "@homematch/i18n";

/**
 * Generic reader of listings published as schema.org (JSON-LD), the format Google asks sites for.
 * Works for portals (Chaves na Mão) and many agency websites, with no site-specific code.
 * Understands: Offer with itemOffered (property), RealEstateListing with offers, Product with offers and
 * additionalProperty, and standalone Residence/Apartment/House. Text patterns match Brazilian (Portuguese) pages.
 */
type Json = Record<string, unknown>;

const LISTING_TYPES =
  /^(RealEstateListing|Product|Accommodation|Residence|Apartment|House|SingleFamilyResidence|Room|Suite)$/;
const PLACE_TYPES = /^(Accommodation|Residence|Apartment|House|SingleFamilyResidence|Room|Suite|Place)$/;

/** schema.org type → label (Residence/Accommodation are generic: the type comes from the title). */
const TYPE_LABEL: Record<string, string> = {
  Apartment: t.listings.propertyTypes.apartment,
  House: t.listings.propertyTypes.house,
  SingleFamilyResidence: t.listings.propertyTypes.house,
  Room: t.listings.room,
  Suite: t.listings.propertyTypes.studio,
};

const typesOf = (o: Json): string[] => {
  const types = o["@type"];
  return (Array.isArray(types) ? types : [types]).filter((x): x is string => typeof x === "string");
};
const isType = (o: Json, re: RegExp) => typesOf(o).some((type) => re.test(type));
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !v.trim()) return undefined;
  // "19500", "-22.9292" → number; "R$ 1.350,00" → Brazilian format.
  return Number.isFinite(Number(v)) ? Number(v) : parseBRL(v);
};
const asObj = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const quant = (v: unknown): number | undefined => {
  const o = asObj(v);
  if (o) return num(o.value) ?? firstInt(str(o.unitText));
  return num(v) ?? firstInt(str(v));
};
const image = (v: unknown): string | undefined => {
  const first = asArr(v)[0];
  return str(first) ?? str(asObj(first)?.url) ?? str(asObj(first)?.contentUrl);
};

function geoOf(o: Json | undefined): LatLng | undefined {
  const g = asObj(o?.geo);
  const lat = num(g?.latitude);
  const lng = num(g?.longitude);
  if (lat == null || lng == null || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return undefined;
  return { lat, lng };
}

export function* walkJson(v: unknown): Generator<Json> {
  if (Array.isArray(v)) for (const x of v) yield* walkJson(x);
  else if (v && typeof v === "object") {
    yield v as Json;
    for (const x of Object.values(v as Json)) if (x && typeof x === "object") yield* walkJson(x);
  }
}

/** JSON-LD blocks of the page (invalid JSON is skipped). */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]!.trim()));
    } catch {
      /* bloco quebrado: ignora */
    }
  }
  return out;
}

/** Is the offer a rental? (sales and "price on request" are left out). */
function isRentOffer(offer: Json, context: string): boolean {
  const fn = String(offer.businessFunction ?? "");
  if (/LeaseOut/i.test(fn)) return true;
  if (/Sell/i.test(fn)) return false;
  if (/RentAction/i.test(String(offer.potentialAction ?? ""))) return true;
  const c = context.toLowerCase();
  if (/(para alugar|aluguel|locacao|locação|\/alugar|-alugar|\/aluguel)/.test(c)) return true;
  if (/(a venda|à venda|para venda|comprar|\/venda)/.test(c)) return false;
  return true; // no signal: the page is a rentals page (the engine only opens rentals pages)
}

/** "Casa para alugar no Jardim Dom Nery em Campinas" → neighborhood and city. */
export function placeFromName(name: string | undefined): { neighbourhood?: string; city?: string } {
  const m = name?.match(/\b(?:alugar|aluguel|loca[cç][aã]o|venda)\s+(?:no|na|em)\s+(.+?)\s+em\s+([^,|–-]+)$/i);
  return m ? { neighbourhood: m[1]!.trim(), city: m[2]!.trim() } : {};
}

const idFrom = (url: string | undefined, fallback: Json): string => {
  if (url) {
    const m = url.match(/id-(\d+)/) ?? url.match(/\/([A-Za-z]{1,4}\d{3,}[\w-]*)\/?(?:[?#].*)?$/);
    if (m) return m[1]!;
    return createHash("sha1").update(url).digest("hex").slice(0, 12);
  }
  return createHash("sha1").update(JSON.stringify(fallback)).digest("hex").slice(0, 12);
};

const PROP_KEYS: [keyof RawListing, RegExp][] = [
  ["bedrooms", /dormit|quarto/i],
  ["bathrooms", /banheiro/i],
  ["parking", /vaga|garage/i],
  ["area", /[aá]rea|m²|metragem/i],
  ["condo", /condom/i],
  ["iptu", /iptu/i],
];

function fromPlace(place: Json | undefined, into: Partial<RawListing>) {
  if (!place) return;
  into.bedrooms ??= num(place.numberOfBedrooms) ?? num(place.numberOfRooms);
  into.bathrooms ??= num(place.numberOfBathroomsTotal) ?? num(place.numberOfFullBathrooms);
  into.area ??= quant(place.floorSize);
  into.geo ??= geoOf(place);
  into.image ??= image(place.image);
  into.description ??= str(place.description);
  const addr = asObj(place.address);
  if (addr) {
    into.street ??= str(addr.streetAddress);
    const locality = str(addr.addressLocality);
    const region = str(addr.addressRegion);
    // Some portals put the neighborhood in addressLocality and "City, ST" in addressRegion.
    if (region && region.includes(",")) {
      into.neighbourhood ??= locality;
      into.cityName ??= region.split(",")[0]!.trim();
    } else {
      into.cityName ??= locality;
    }
  }
  for (const p of asArr(place.additionalProperty)) {
    const o = asObj(p);
    const name = str(o?.name);
    if (!o || !name) continue;
    if (/tipo/i.test(name)) into.typeLabel ??= str(o.value);
    for (const [key, re] of PROP_KEYS) {
      if (re.test(name))
        (into as Record<string, unknown>)[key] ??=
          key === "condo" || key === "iptu"
            ? parseBRL(String(o.value ?? ""))
            : (num(o.value) ?? firstInt(str(o.value)));
    }
  }
}

/** Pure parsing: rental listings in a page's JSON-LD (search or listing page). */
export function parseSchemaOrgListings(html: string, pageUrl: string): RawListing[] {
  const out = new Map<string, RawListing>();
  const add = (r: Partial<RawListing>, src: Json) => {
    if (!r.rent || r.rent < 100) return; // no price or "price on request"
    const url = safeExternalUrl(r.url, pageUrl);
    if (!url) return;
    const id = idFrom(url, src);
    if (out.has(id)) return;
    const place = placeFromName(r.title);
    out.set(id, {
      ...r,
      id,
      url,
      rent: r.rent,
      neighbourhood: r.neighbourhood ?? place.neighbourhood,
      cityName: r.cityName ?? place.city,
    } as RawListing);
  };

  for (const block of jsonLdBlocks(html)) {
    for (const o of walkJson(block)) {
      const types = typesOf(o);
      // 1) Offer { itemOffered: property } — e.g. Chaves na Mão.
      if (types.includes("Offer") && asObj(o.itemOffered)) {
        const item = asObj(o.itemOffered)!;
        const title = str(o.name) ?? str(item.name);
        if (!isRentOffer(o, `${title ?? ""} ${str(o.url) ?? ""}`)) continue;
        const r: Partial<RawListing> = {
          url: str(o.url) ?? str(item["@id"]) ?? str(item.url),
          title,
          rent: num(o.price) ?? num(asObj(o.priceSpecification)?.price),
          agency: str(asObj(o.offeredBy)?.name) ?? str(asObj(o.seller)?.name),
          typeLabel: TYPE_LABEL[typesOf(item).find((type) => PLACE_TYPES.test(type)) ?? ""],
        };
        fromPlace(item, r);
        add(r, o);
        continue;
      }
      // 2) Listing with offers (RealEstateListing, Product…) — e.g. Kenlo, Sites do Mercado.
      if (isType(o, LISTING_TYPES) && o.offers) {
        const title = str(o.name);
        const url = str(o.url) ?? str(o["@id"]);
        const offers = asArr(o.offers)
          .map(asObj)
          .filter((x): x is Json => !!x);
        const rent = offers.find(
          (of) => isRentOffer(of, `${title ?? ""} ${url ?? ""}`) && !/Sell/i.test(String(of.businessFunction ?? "")),
        );
        if (!rent) continue;
        const r: Partial<RawListing> = {
          url,
          title,
          rent: num(rent.price) ?? num(rent.lowPrice) ?? num(asObj(rent.priceSpecification)?.price),
          agency: str(asObj(o.brand)?.name) ?? str(asObj(rent.offeredBy)?.name),
          description: str(o.description),
          image: image(o.image),
        };
        const city = str(asObj(rent.eligibleRegion)?.name);
        if (city) r.cityName = city.split(",")[0]!.trim();
        fromPlace(o, r);
        fromPlace(asObj(o.mainEntity) ?? asObj(o.about), r);
        add(r, o);
      }
    }
  }
  return [...out.values()];
}
