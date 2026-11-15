import type { Listing, ListingFilters, PropertyType } from "@homematch/contracts";
import { hasAmenity, matchesFilters, type MapFilters } from "./listing-filters.js";

/** Parâmetros da análise de regiões (não há mais tempo máximo: as regiões têm nível pelas prioridades). */
export interface Params {
  maxWalkToStopM: number;
  cellSizeM: number;
}

export const DEFAULT_PARAMS: Params = { maxWalkToStopM: 600, cellSizeM: 500 };

/** Parâmetros salvos de versões antigas (com tempo máximo e peso do trajeto) continuam valendo. */
export function normalizeParams(p: Partial<Params> & Record<string, unknown>): Params {
  return {
    maxWalkToStopM: Number(p.maxWalkToStopM) || DEFAULT_PARAMS.maxWalkToStopM,
    cellSizeM: Number(p.cellSizeM) || DEFAULT_PARAMS.cellSizeM,
  };
}

export type SortKey = "match" | "price" | "commute" | "area";

/** O que a pessoa procura (vai para a busca nos sites) + alvo de preço, ordem e comodidades (no navegador). */
export interface Filters extends MapFilters {
  sort: SortKey;
  /** Quanto a pessoa quer pagar por mês (alvo). O teto da busca é o alvo + a folga. */
  budget?: number | null;
  /** Quanto aceita passar do alvo, em %. */
  slack?: number;
}

export const DEFAULT_FILTERS: Filters = {
  types: [],
  priceMin: null,
  priceMax: null,
  basis: "total",
  minBedrooms: 0,
  minBathrooms: 0,
  minParking: 0,
  minArea: 0,
  sort: "match",
  amenities: [],
  hideUnknown: false,
  budget: null,
  slack: 15,
};

/** Filtros salvos de versões antigas (sem alvo/folga) continuam valendo. */
export function normalizeFilters(f: Partial<Filters>): Filters {
  const out = { ...DEFAULT_FILTERS, ...f };
  if (f.budget === undefined) {
    // Antes só havia o teto: ele vira o alvo, sem folga (o teto continua o mesmo).
    out.budget = out.priceMax ?? null;
    out.slack = 0;
    out.sort = "match"; // a ordem nova passa a ser a padrão
  }
  if (!["match", "price", "commute", "area"].includes(out.sort)) out.sort = "match";
  return out;
}

/** Teto de preço = alvo + folga. */
export const ceilingOf = (budget: number | null | undefined, slack = 0) =>
  budget ? Math.round(budget * (1 + slack / 100)) : null;

/** Muda alvo/folga mantendo o teto (priceMax) coerente. */
export function withBudget(f: Filters, budget: number | null, slack = f.slack ?? 0): Filters {
  return { ...f, budget, slack, priceMax: ceilingOf(budget, slack) };
}

/** Só a parte que os sites entendem (o resto é aplicado no navegador). */
export const searchFilters = (f: Filters): ListingFilters => ({
  types: f.types,
  priceMin: f.priceMin,
  priceMax: f.priceMax,
  basis: f.basis,
  minBedrooms: f.minBedrooms,
  minBathrooms: f.minBathrooms ?? 0,
  minParking: f.minParking ?? 0,
  minArea: f.minArea ?? 0,
});

/**
 * Busca larga: o que vai para os sites passa um pouco do pedido (preço até +20% sobre o teto, um quarto
 * a menos, qualquer tipo). Assim a tela nunca fica vazia por R$ 15: o que passa vira "quase lá", dizendo o quê.
 */
export const WIDE = { price: 0.2, bedrooms: 1 };

export const wideFilters = (f: Filters): ListingFilters => ({
  ...searchFilters(f),
  types: [],
  priceMax: f.priceMax ? Math.round(f.priceMax * (1 + WIDE.price)) : null,
  minBedrooms: Math.max(0, f.minBedrooms - WIDE.bedrooms),
});

/** O que some de vez da lista: só o que passa da busca larga e os filtros finos (banheiros, vagas, área). */
export function visibleListings<T extends Listing>(list: T[], f: Filters): T[] {
  const wide = wideFilters(f);
  const wanted = f.amenities ?? [];
  return list.filter(
    (l) => matchesFilters(l, wide) && !(f.hideUnknown && wanted.some((id) => hasAmenity(l, id) === undefined)),
  );
}

export const SEARCH_TYPES: PropertyType[] = ["apartamento", "casa", "casa_condominio", "studio"];

/** Preço que vale para a pessoa (total ou só aluguel). */
export const priceOf = (l: Listing, basis: Filters["basis"]) => (basis === "rent" ? l.rent : l.total);
