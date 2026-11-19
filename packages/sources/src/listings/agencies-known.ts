import type { City } from "@homematch/contracts";
import { slugify } from "./normalize.js";

/**
 * Agencies known per city, besides the ones in OpenStreetMap (which has few agency websites). Each one goes through
 * the same inspection as the others (robots.txt, platform, rentals page): listing a site here does not skip any rule.
 * Key: city slug + state ("campinas-sp").
 */
const KNOWN: Record<string, { name: string; site: string }[]> = {
  "campinas-sp": [
    { name: "Imobiliária Melhor Negócio", site: "https://www.imobiliariamelhornegocio.com.br" },
    { name: "Home Hunters", site: "https://www.homehunters.com.br" },
    { name: "Vide Imóveis", site: "https://www.videimoveis.com.br" },
    { name: "Bonone Amaral Imóveis", site: "https://www.bononeamaralimoveis.com.br" },
    { name: "Imobiliária Construa", site: "https://www.imobiliariaconstrua.com.br" },
    { name: "Petrucci Gestão Imobiliária", site: "https://www.petrucci.com.br" },
  ],
};

export function knownAgencies(city: Pick<City, "name" | "stateCode">): { name: string; site: string }[] {
  return KNOWN[`${slugify(city.name)}-${(city.stateCode ?? "").toLowerCase()}`] ?? [];
}
