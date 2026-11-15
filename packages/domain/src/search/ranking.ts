import { PROPERTY_TYPE_LABEL } from "@homematch/contracts/constants";
import type { Cell, Listing } from "@homematch/contracts";
import { meters, money } from "../format.js";
import { priceOf, type Filters } from "./criteria.js";
import { AMENITY_FILTERS, amenityRank, hasAmenity } from "./listing-filters.js";

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
export function missesOf(l: Listing, cell: Cell | undefined, f: Filters, near: NearWant[]): Miss[] {
  const out: Miss[] = [];
  const price = priceOf(l, f.basis);
  if (f.priceMax && price > f.priceMax)
    out.push({ kind: "price", label: `${money(price - f.priceMax)} acima do teto` });
  if (f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms) {
    const n = l.bedrooms ?? 0;
    out.push({ kind: "rooms", label: n ? `${n} ${n === 1 ? "quarto" : "quartos"}` : "Sem quarto separado" });
  }
  if (f.types.length && !f.types.includes(l.type))
    out.push({ kind: "type", label: PROPERTY_TYPE_LABEL[l.type] ?? l.typeLabel });
  if (!cell) out.push({ kind: "commute", label: "Fora das regiões recomendadas" });
  else {
    for (const w of near) {
      const d = cell.featureDist[w.id];
      if (d == null) out.push({ kind: "place", label: `${w.label} longe` });
      else if (d > w.radius) out.push({ kind: "place", label: `${w.label} a ${meters(d)}` });
    }
  }
  for (const a of AMENITY_FILTERS) {
    if (f.amenities?.includes(a.id) && hasAmenity(l, a.id) === false)
      out.push({ kind: "item", label: `Sem ${a.short.toLowerCase()}` });
  }
  return out;
}

/**
 * O que pesa de verdade na decisão: preço, quartos e estar numa região recomendada. O tempo até o trabalho e o que
 * tem perto já entram no nível da região; tipo e itens são desejo.
 */
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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Melhor tempo até o trabalho na cidade e o que ainda conta como bem servido (da análise). */
export interface CommuteRef {
  bestMin: number;
  refMin: number;
}

/**
 * Quanto o imóvel combina com a busca (0–100): preço contra o alvo, tempo até o trabalho (comparado com o melhor
 * da cidade), comodidades confirmadas no anúncio e a nota da região (as prioridades atingidas).
 */
export function matchScore(l: Listing, cell: Cell | undefined, f: Filters, ref: CommuteRef): number {
  const price = priceOf(l, f.basis);
  const budget = f.budget ?? null;
  const priceFit = !budget || !price ? 0.7 : price <= budget ? 1 : clamp01(1 - (price - budget) / (budget * 0.3));

  const commuteFit = cell
    ? clamp01(1 - (Math.max(0, cell.commuteMin - ref.bestMin) / Math.max(10, ref.refMin - ref.bestMin)) * 0.6)
    : 0.4;

  const wanted = f.amenities ?? [];
  const amenFit = wanted.length
    ? wanted.reduce((s, id) => s + (hasAmenity(l, id) === true ? 1 : hasAmenity(l, id) === undefined ? 0.5 : 0), 0) /
      wanted.length
    : 1;

  const areaFit = cell ? clamp01(cell.score / 100) : 0.5;
  // Quarto a menos ou outro tipo: entram na lista (busca larga), mas pesam na nota.
  const roomsFit = f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms ? 0.8 : 1;
  const typeFit = f.types.length && !f.types.includes(l.type) ? 0.9 : 1;
  return Math.round(100 * (0.35 * priceFit + 0.3 * commuteFit + 0.2 * amenFit + 0.15 * areaFit) * roomsFit * typeFit);
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
    f.sort === "commute"
      ? (x.cell?.commuteMin ?? 999)
      : f.sort === "area"
        ? -(x.l.area ?? 0)
        : f.sort === "price"
          ? priceOf(x.l, f.basis) || Infinity
          : -x.match;
  // Quem atende a tudo vem antes, depois o "quase lá". Pela nota, as comodidades já entram no cálculo;
  // nas outras ordens, quem confirma os itens vem antes.
  return [...list].sort(
    (a, b) => tierOf(a.misses) - tierOf(b.misses) || (f.sort === "match" ? 0 : rank(a) - rank(b)) || key(a) - key(b),
  );
}
