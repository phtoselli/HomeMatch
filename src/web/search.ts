import { amenityRank, hasAmenity, type MapFilters } from "../shared/filters";
import type { Cell, Listing, ListingFilters, PropertyType } from "../shared/types";
import type { IconName } from "./icons";

export { amenityRank, applyFilters, hasAmenity } from "../shared/filters";

/** Parâmetros da análise de regiões. */
export interface Params {
  maxCommuteMin: number;
  maxWalkToStopM: number;
  cellSizeM: number;
  commuteWeight: number;
}

export const DEFAULT_PARAMS: Params = { maxCommuteMin: 45, maxWalkToStopM: 600, cellSizeM: 500, commuteWeight: 0.7 };

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
  types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0, minBathrooms: 0, minParking: 0, minArea: 0,
  sort: "match", amenities: [], hideUnknown: false, budget: null, slack: 15,
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
  types: f.types, priceMin: f.priceMin, priceMax: f.priceMax, basis: f.basis,
  minBedrooms: f.minBedrooms, minBathrooms: f.minBathrooms ?? 0, minParking: f.minParking ?? 0, minArea: f.minArea ?? 0,
});

export const SEARCH_TYPES: PropertyType[] = ["apartamento", "casa", "casa_condominio", "studio"];

export const AMENITY_FILTERS: { id: string; label: string; short: string; icon: IconName }[] = [
  { id: "armario_cozinha", label: "Armário na cozinha", short: "Armário cozinha", icon: "kitchen" },
  { id: "armario_quarto", label: "Guarda-roupa no quarto", short: "Guarda-roupa", icon: "wardrobe" },
  { id: "pia", label: "Pia / bancada", short: "Pia", icon: "drop" },
];

export const AMENITY_LABEL: Record<string, string> = {
  ...Object.fromEntries(AMENITY_FILTERS.map((a) => [a.id, a.label])),
  mobiliado: "Mobiliado",
};

/** Preço que vale para a pessoa (total ou só aluguel). */
export const priceOf = (l: Listing, basis: Filters["basis"]) => (basis === "rent" ? l.rent : l.total);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Quanto o imóvel combina com a busca (0–100): preço contra o alvo, tempo até o trabalho,
 * comodidades confirmadas no anúncio e a nota da região (o que tem perto).
 */
export function matchScore(l: Listing, cell: Cell | undefined, f: Filters, maxCommuteMin: number): number {
  const price = priceOf(l, f.basis);
  const budget = f.budget ?? null;
  const priceFit = !budget || !price ? 0.7 : price <= budget ? 1 : clamp01(1 - (price - budget) / (budget * 0.3));

  const commuteFit = cell ? clamp01(1 - (Math.max(0, cell.commuteMin - 20) / Math.max(10, maxCommuteMin - 20)) * 0.6) : 0.4;

  const wanted = f.amenities ?? [];
  const amenFit = wanted.length
    ? wanted.reduce((s, id) => s + (hasAmenity(l, id) === true ? 1 : hasAmenity(l, id) === undefined ? 0.5 : 0), 0) / wanted.length
    : 1;

  const areaFit = cell ? clamp01(cell.score / 100) : 0.5;
  return Math.round(100 * (0.35 * priceFit + 0.3 * commuteFit + 0.2 * amenFit + 0.15 * areaFit));
}

export interface Ranked {
  l: Listing;
  cell?: Cell;
  match: number;
}

export function sortRanked(list: Ranked[], f: Filters): Ranked[] {
  const wanted = f.amenities ?? [];
  const rank = (x: Ranked) => (wanted.length ? amenityRank(x.l, wanted) : 0);
  const key = (x: Ranked) =>
    f.sort === "commute" ? x.cell?.commuteMin ?? 999
    : f.sort === "area" ? -(x.l.area ?? 0)
    : f.sort === "price" ? priceOf(x.l, f.basis) || Infinity
    : -x.match;
  // Pela nota, as comodidades já entram no cálculo; nas outras ordens, quem confirma tudo vem antes.
  return [...list].sort((a, b) => (f.sort === "match" ? 0 : rank(a) - rank(b)) || key(a) - key(b));
}
