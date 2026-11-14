import { slugify } from "../normalize.js";
import type { RawListing, SiteExtension } from "../core/types.js";
import { parseVivaReal } from "../vivareal.js";

/**
 * ZAP Imóveis: mesmo grupo e mesma plataforma do VivaReal (os cards têm a mesma marcação), então o
 * parse é o do VivaReal; só a URL muda. Aceita preço máximo e página na URL (permitidos no robots.txt).
 */
const SITE = "https://www.zapimoveis.com.br";

/** Parse puro de uma página de busca do ZAP. */
export function parseZap(html: string): RawListing[] {
  return parseVivaReal(html).map((c) => {
    const [neighbourhood, cityName] = (c.location ?? "").split(",").map((s) => s.trim());
    return {
      id: c.id,
      url: c.url,
      title: c.title,
      typeLabel: c.typeLabel,
      rent: c.rent,
      condo: c.condo,
      iptu: c.iptu,
      area: c.area,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      parking: c.parking,
      street: c.street,
      neighbourhood: neighbourhood || undefined,
      cityName: cityName || undefined,
      image: c.image,
      description: c.title,
    };
  });
}

export const zapImoveis: SiteExtension = {
  id: "zapimoveis",
  label: "ZAP Imóveis",
  home: SITE,
  scope: "region",
  perPage: 30,
  maxPages: 2,
  minIntervalMs: 2500,
  url({ city, region, filters, page }) {
    if (!city.stateCode) return null;
    const q = new URLSearchParams();
    // O ZAP filtra pelo aluguel; no modo "total" o teto do aluguel é o próprio teto (o servidor refina).
    if (filters?.priceMax) q.set("precoMaximo", String(filters.priceMax));
    if (page > 1) q.set("pagina", String(page));
    const qs = q.toString();
    return `${SITE}/aluguel/imoveis/${city.stateCode.toLowerCase()}+${slugify(city.name)}++${slugify(region.name)}/${qs ? `?${qs}` : ""}`;
  },
  parse: (html) => parseZap(html),
};
