import { slugify } from "../normalize.js";
import { parseSchemaOrgListings } from "../core/schemaorg.js";
import type { SiteExtension } from "../core/types.js";

/**
 * Chaves na Mão: portal com anúncios de muitas imobiliárias. A página de busca por bairro traz os
 * anúncios em schema.org (com coordenada e imobiliária), então o parse é o genérico.
 * O robots.txt do site proíbe URLs com "?" (inclusive a paginação "?pg="): só a 1ª página de cada bairro,
 * e por tipo de imóvel quando a pessoa escolheu um só.
 */
const SITE = "https://www.chavesnamao.com.br";

const TYPE_PATH: Record<string, string> = {
  apartamento: "apartamentos-para-alugar",
  casa: "casas-para-alugar",
  casa_condominio: "casas-em-condominio-para-alugar",
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
