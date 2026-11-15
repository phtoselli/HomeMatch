import { createHash } from "node:crypto";
import type { LatLng } from "@homematch/contracts";
import { safeExternalUrl } from "@homematch/domain";
import { firstInt, parseBRL } from "../normalize.js";
import type { RawListing } from "./types.js";

/**
 * Leitura genérica de anúncios publicados em schema.org (JSON-LD), o formato que o Google pede aos sites.
 * Serve para portais (Chaves na Mão) e para muitos sites de imobiliária, sem código próprio de cada um.
 * Entende: Offer com itemOffered (imóvel), RealEstateListing com offers, Product com offers e
 * additionalProperty, e Residence/Apartment/House soltos.
 */
type Json = Record<string, unknown>;

const LISTING_TYPES =
  /^(RealEstateListing|Product|Accommodation|Residence|Apartment|House|SingleFamilyResidence|Room|Suite)$/;
const PLACE_TYPES = /^(Accommodation|Residence|Apartment|House|SingleFamilyResidence|Room|Suite|Place)$/;

/** Tipo schema.org → rótulo (Residence/Accommodation são genéricos: o tipo sai do título). */
const TYPE_LABEL: Record<string, string> = {
  Apartment: "Apartamento",
  House: "Casa",
  SingleFamilyResidence: "Casa",
  Room: "Quarto",
  Suite: "Studio",
};

const typesOf = (o: Json): string[] => {
  const t = o["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
};
const isType = (o: Json, re: RegExp) => typesOf(o).some((t) => re.test(t));
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !v.trim()) return undefined;
  // "19500", "-22.9292" → número; "R$ 1.350,00" → formato brasileiro.
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

/** Blocos JSON-LD da página (os que não são JSON válido ficam de fora). */
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

/** Oferta é de aluguel? (venda e "sob consulta" ficam de fora). */
function isRentOffer(offer: Json, context: string): boolean {
  const fn = String(offer.businessFunction ?? "");
  if (/LeaseOut/i.test(fn)) return true;
  if (/Sell/i.test(fn)) return false;
  if (/RentAction/i.test(String(offer.potentialAction ?? ""))) return true;
  const c = context.toLowerCase();
  if (/(para alugar|aluguel|locacao|locação|\/alugar|-alugar|\/aluguel)/.test(c)) return true;
  if (/(a venda|à venda|para venda|comprar|\/venda)/.test(c)) return false;
  return true; // sem sinal: a página é de aluguel (o motor só abre páginas de aluguel)
}

/** "Casa para alugar no Jardim Dom Nery em Campinas" → bairro e cidade. */
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
    // Alguns portais põem o bairro em addressLocality e "Cidade, UF" em addressRegion.
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

/** Parse puro: anúncios de aluguel em JSON-LD de uma página (busca ou anúncio). */
export function parseSchemaOrgListings(html: string, pageUrl: string): RawListing[] {
  const out = new Map<string, RawListing>();
  const add = (r: Partial<RawListing>, src: Json) => {
    if (!r.rent || r.rent < 100) return; // sem preço ou "sob consulta"
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
      // 1) Offer { itemOffered: imóvel } — ex.: Chaves na Mão.
      if (types.includes("Offer") && asObj(o.itemOffered)) {
        const item = asObj(o.itemOffered)!;
        const title = str(o.name) ?? str(item.name);
        if (!isRentOffer(o, `${title ?? ""} ${str(o.url) ?? ""}`)) continue;
        const r: Partial<RawListing> = {
          url: str(o.url) ?? str(item["@id"]) ?? str(item.url),
          title,
          rent: num(o.price) ?? num(asObj(o.priceSpecification)?.price),
          agency: str(asObj(o.offeredBy)?.name) ?? str(asObj(o.seller)?.name),
          typeLabel: TYPE_LABEL[typesOf(item).find((t) => PLACE_TYPES.test(t)) ?? ""],
        };
        fromPlace(item, r);
        add(r, o);
        continue;
      }
      // 2) Anúncio com offers (RealEstateListing, Product…) — ex.: Kenlo, Sites do Mercado.
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
