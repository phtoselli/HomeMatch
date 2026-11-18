import { firstInt, parseBRL, slugify } from "../normalize.js";
import type { RawListing, SiteExtension } from "../core/types.js";
import { t } from "@homematch/i18n";

/**
 * Lopes: a national agency. The public per-neighborhood search page ships the listings in the Angular state
 * (`<script id="ng-state">`), with coordinates, prices and description. Only the first page comes rendered (the
 * others are loaded through the site's internal API, which we do not use).
 */
const SITE = "https://www.lopes.com.br";

interface LopesProduct {
  id: string;
  type?: string;
  productType?: string;
  fullMonthlyPriceFormat?: string;
  subPrice?: string;
  street?: string;
  neighborhood?: string;
  attributes?: { type: string; value: string }[];
  photo?: { mediumUrl?: string; smallUrl?: string }[];
  lat?: number;
  lng?: number;
  description?: string;
  locationDTO?: { city?: string; neighborhood?: string };
}

const attr = (p: LopesProduct, t: string) => firstInt(p.attributes?.find((a) => a.type === t)?.value);
const money = (s: string | undefined, label: string) =>
  parseBRL(s?.match(new RegExp(`${label}:\\s*R\\$\\s*[\\d.,]+`, "i"))?.[0]);

/** Pure parsing of a Lopes search page. */
export function parseLopes(html: string): RawListing[] {
  const m = html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let state: Record<string, { products?: { content?: LopesProduct[] } }>;
  try {
    state = JSON.parse(m[1]!);
  } catch {
    return [];
  }
  const out: RawListing[] = [];
  for (const [key, v] of Object.entries(state)) {
    if (!key.startsWith("search/")) continue;
    for (const p of v?.products?.content ?? []) {
      if (p.productType && p.productType !== "real_estate") continue;
      const sub = p.subPrice?.replace(/&nbsp;/g, " ");
      const rent = money(sub, "Aluguel") ?? parseBRL(p.fullMonthlyPriceFormat);
      if (!rent) continue; // sale only
      const [neighborhood, cityName] = (p.neighborhood ?? "").split(",").map((s) => s.trim());
      out.push({
        id: p.id,
        url: `${SITE}/imovel/${p.id}`,
        title: t.listings.titleIn(p.type ?? t.links.property, neighborhood),
        typeLabel: p.type,
        rent,
        condo: money(sub, "Condomínio"),
        iptu: money(sub, "IPTU"),
        total: parseBRL(p.fullMonthlyPriceFormat),
        area: attr(p, "area_attr"),
        bedrooms: attr(p, "bedroom_attr"),
        bathrooms: attr(p, "bathroom_attr"),
        parking: attr(p, "parking_lots_attr"),
        street: p.street,
        neighbourhood: p.locationDTO?.neighborhood ?? neighborhood,
        cityName: p.locationDTO?.city ?? cityName,
        geo: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : undefined,
        image: p.photo?.[0]?.mediumUrl ?? p.photo?.[0]?.smallUrl,
        description: p.description,
        agency: "Lopes",
      });
    }
  }
  return out;
}

export const lopes: SiteExtension = {
  id: "lopes",
  label: "Lopes",
  home: SITE,
  scope: "region",
  perPage: 23,
  maxPages: 1,
  minIntervalMs: 2000,
  url: ({ city, region, page }) =>
    page > 1 || !city.stateCode
      ? null
      : `${SITE}/busca/aluguel/br/${city.stateCode.toLowerCase()}/${slugify(city.name)}/${slugify(region.name)}`,
  parse: (html) => parseLopes(html),
};
