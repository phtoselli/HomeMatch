import { firstInt, parseBRL, slugify } from "../normalize.js";
import type { RawListing, SiteExtension } from "../core/types.js";

/**
 * Lopes: imobiliária nacional. A página pública de busca por bairro já vem com os imóveis no estado
 * do Angular (`<script id="ng-state">`), com coordenada, preços e descrição. Só a 1ª página vem pronta
 * (as outras são carregadas pela API interna do site, que não usamos).
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

/** Parse puro da página de busca da Lopes. */
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
      if (!rent) continue; // só venda
      const [bairro, cidade] = (p.neighborhood ?? "").split(",").map((s) => s.trim());
      out.push({
        id: p.id,
        url: `${SITE}/imovel/${p.id}`,
        title: [p.type, bairro].filter(Boolean).join(" em "),
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
        neighbourhood: p.locationDTO?.neighborhood ?? bairro,
        cityName: p.locationDTO?.city ?? cidade,
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
