import { amenityRank, hasAmenity, matchesFilters, type MapFilters } from "../shared/filters";
import { PROPERTY_TYPE_LABEL } from "../shared/types";
import type { Cell, Listing, ListingFilters, PropertyType } from "../shared/types";
import { meters, money } from "./format";
import type { IconName } from "./icons";

export { amenityRank, hasAmenity } from "../shared/filters";

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

export type MissKind = "price" | "rooms" | "type" | "commute" | "place" | "item";
/** Uma coisa em que o imóvel não bate com o pedido, já em texto curto para o card. */
export interface Miss {
  kind: MissKind;
  label: string;
}

/** O que a pessoa quer perto de casa (id, nome curto, raio em metros). */
export interface NearWant {
  id: string;
  label: string;
  radius: number;
}

/** Tudo em que o imóvel não bate com o pedido. Vazio = atende a tudo. */
export function missesOf(l: Listing, cell: Cell | undefined, f: Filters, maxCommuteMin: number, near: NearWant[]): Miss[] {
  const out: Miss[] = [];
  const price = priceOf(l, f.basis);
  if (f.priceMax && price > f.priceMax) out.push({ kind: "price", label: `${money(price - f.priceMax)} acima do teto` });
  if (f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms) {
    const n = l.bedrooms ?? 0;
    out.push({ kind: "rooms", label: n ? `${n} ${n === 1 ? "quarto" : "quartos"}` : "Sem quarto separado" });
  }
  if (f.types.length && !f.types.includes(l.type)) out.push({ kind: "type", label: PROPERTY_TYPE_LABEL[l.type] ?? l.typeLabel });
  if (!cell) out.push({ kind: "commute", label: "Trajeto não calculado" });
  else {
    if (cell.commuteMin > maxCommuteMin) out.push({ kind: "commute", label: `${cell.commuteMin} min até o trabalho` });
    for (const w of near) {
      const d = cell.featureDist[w.id];
      if (d == null) out.push({ kind: "place", label: `${w.label} longe` });
      else if (d > w.radius) out.push({ kind: "place", label: `${w.label} a ${meters(d)}` });
    }
  }
  for (const a of AMENITY_FILTERS) {
    if (f.amenities?.includes(a.id) && hasAmenity(l, a.id) === false) out.push({ kind: "item", label: `Sem ${a.short.toLowerCase()}` });
  }
  return out;
}

/** O que pesa de verdade na decisão: preço, quartos e tempo até o trabalho. O resto (o que tem perto, tipo, itens) é desejo. */
export const ESSENTIAL: MissKind[] = ["price", "rooms", "commute"];

/**
 * Grupo do imóvel na lista:
 * 0 = atende a tudo; 1 = o essencial bate, falta algo de perto ou do imóvel;
 * 2 = quase lá (uma coisa essencial passa um pouco); 3 = outras opções (duas ou mais).
 */
export function tierOf(misses: Miss[]): number {
  if (!misses.length) return 0;
  const essential = misses.filter((m) => ESSENTIAL.includes(m.kind)).length;
  return essential === 0 ? 1 : essential === 1 ? 2 : 3;
}

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
  // Quarto a menos ou outro tipo: entram na lista (busca larga), mas pesam na nota.
  const roomsFit = f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms ? 0.8 : 1;
  const typeFit = f.types.length && !f.types.includes(l.type) ? 0.9 : 1;
  return Math.round(100 * (0.35 * priceFit + 0.3 * commuteFit + 0.2 * amenFit + 0.15 * areaFit) * roomsFit * typeFit);
}

/** Por que a busca voltou vazia: o que existe logo acima do teto e em outros tipos. */
export interface Diagnosis {
  ceiling: number | null;
  /** Mesmo tipo e quartos, até ~60% acima do teto: quantos e o mais barato. */
  sameCount: number;
  cheapestSame?: number;
  /** Qualquer tipo e número de quartos, dentro do teto. */
  others: number;
  othersCheapest?: number;
}

export function diagnose(same: Listing[], any: Listing[], f: Filters): Diagnosis {
  const prices = (ls: Listing[]) => ls.map((l) => priceOf(l, f.basis)).filter((p) => p > 0);
  const ceiling = f.priceMax ?? null;
  const sp = prices(same);
  const ap = prices(any).filter((p) => ceiling == null || p <= ceiling);
  return {
    ceiling,
    sameCount: sp.length,
    cheapestSame: sp.length ? Math.min(...sp) : undefined,
    others: ap.length,
    othersCheapest: ap.length ? Math.min(...ap) : undefined,
  };
}

/** Folga (%) mínima para o teto alcançar um preço. */
export const slackToReach = (budget: number, price: number) => Math.max(0, Math.ceil((price / budget - 1) * 100));

export interface Ranked {
  l: Listing;
  cell?: Cell;
  match: number;
  /** O que não bate com o pedido (vazio = atende a tudo). */
  misses: Miss[];
}

export function sortRanked(list: Ranked[], f: Filters): Ranked[] {
  const wanted = f.amenities ?? [];
  const rank = (x: Ranked) => (wanted.length ? amenityRank(x.l, wanted) : 0);
  const key = (x: Ranked) =>
    f.sort === "commute" ? x.cell?.commuteMin ?? 999
    : f.sort === "area" ? -(x.l.area ?? 0)
    : f.sort === "price" ? priceOf(x.l, f.basis) || Infinity
    : -x.match;
  // Quem atende a tudo vem antes, depois o "quase lá". Pela nota, as comodidades já entram no cálculo;
  // nas outras ordens, quem confirma os itens vem antes.
  return [...list].sort(
    (a, b) => tierOf(a.misses) - tierOf(b.misses) || (f.sort === "match" ? 0 : rank(a) - rank(b)) || key(a) - key(b),
  );
}
