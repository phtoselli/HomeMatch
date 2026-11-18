import type { PropertyType } from "@homematch/contracts";
import { slugify } from "../normalize.js";
import { parseSchemaOrgListings } from "../core/schemaorg.js";
import type { SiteExtension } from "../core/types.js";

/**
 * Chaves na Mão: a portal with listings from many agencies. The per-neighborhood search page has listings in
 * schema.org (with coordinates and agency), so the generic parser is used. The site's robots.txt disallows URLs
 * with "?" (including the "?pg=" pagination): only the first page of each neighborhood, and per property type when
 * the user picked a single one.
 */
const SITE = "https://www.chavesnamao.com.br";

const TYPE_PATH: Partial<Record<PropertyType, string>> = {
  apartment: "apartamentos-para-alugar",
  house: "casas-para-alugar",
  condo_house: "casas-em-condominio-para-alugar",
  studio: "kitnets-para-alugar",
};

export const chavesNaMao: SiteExtension = {
  id: "chavesnamao",
  label: "Chaves na Mão",
  home: SITE,
  scope: "region",
  perPage: 30,
  maxPages: 1,
  minIntervalMs: 2000,
  url({ city, region, filters, page }) {
    if (page > 1 || !city.stateCode) return null;
    const types = filters?.types ?? [];
    const path = (types.length === 1 && TYPE_PATH[types[0]!]) || "imoveis-para-alugar";
    return `${SITE}/${path}/${city.stateCode.toLowerCase()}-${slugify(city.name)}/${slugify(region.name)}/`;
  },
  parse: parseSchemaOrgListings,
};
