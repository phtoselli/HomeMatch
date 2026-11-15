import type { RegionLevel } from "@homematch/contracts";
import { REGION_LEVELS } from "@homematch/contracts/constants";

/**
 * Níveis de região: em vez de um tempo máximo até o trabalho, cada pedaço da cidade é julgado pelo que a pessoa
 * disse que importa. Cada critério (transporte até o trabalho e cada lugar que quer perto) tem um peso:
 * 3 = principal, 2 = importante, 1 = bom ter.
 *
 * - excelente: a principal foi atingida e a maior parte do peso também (≥ 75%);
 * - boa: a principal foi atingida;
 * - ok: alguma coisa foi atingida, mas não a principal;
 * - fora (null): nada foi atingido. Imóveis só aparecem nas regiões com nível.
 */

export const IMPORTANCE = { main: 3, important: 2, nice: 1 } as const;
export type Importance = 1 | 2 | 3;

/** Critério de transporte (os outros têm o id da característica). */
export const TRANSIT_CRITERION = "transporte";

/** Parte do peso que precisa ser atingida (com a principal) para "excelente". */
export const EXCELLENT_SHARE = 0.75;

export interface CriterionResult {
  id: string;
  weight: number;
  hit: boolean;
  /** 0..1: quão bem foi atingido (0 se não foi). */
  fit: number;
}

/** O critério principal: o de maior peso (no empate, o primeiro da lista, que é o transporte). */
export function mainCriterion<T extends { id: string; weight: number }>(cs: T[]): T | undefined {
  let best: T | undefined;
  for (const c of cs) if (c.weight > 0 && (!best || c.weight > best.weight)) best = c;
  return best;
}

export function levelOf(cs: CriterionResult[]): RegionLevel | null {
  const main = mainCriterion(cs);
  if (!main) return null;
  const total = cs.reduce((s, c) => s + c.weight, 0);
  const hitW = cs.reduce((s, c) => s + (c.hit ? c.weight : 0), 0);
  if (!hitW) return null;
  if (!main.hit) return "ok";
  return hitW / total >= EXCELLENT_SHARE ? "excelente" : "boa";
}

/** Nota 0–100: soma dos pesos atingidos, cada um pelo quão bem foi atingido. Ordena dentro do mesmo nível. */
export function criteriaScore(cs: CriterionResult[]): number {
  const total = cs.reduce((s, c) => s + c.weight, 0);
  if (!total) return 0;
  return Math.round((1000 * cs.reduce((s, c) => s + c.weight * (c.hit ? c.fit : 0), 0)) / total) / 10;
}

/** Ordem dos níveis: 2 = excelente, 1 = boa, 0 = ok. */
export const levelRank = (l: RegionLevel | null | undefined) => (l ? REGION_LEVELS.indexOf(l) : -1);

/** O nível passa do mínimo escolhido (ex.: "boa" mostra boa e excelente). */
export const atLeast = (l: RegionLevel | null | undefined, min: RegionLevel) => levelRank(l) >= levelRank(min);

export const LEVEL_LABEL: Record<RegionLevel, string> = { excelente: "Excelente", boa: "Boa", ok: "Ok" };

/**
 * Transporte sem limite de tempo: "atingido" é chegar ao trabalho em até `refMin`, que vem do melhor tempo da
 * própria cidade (o melhor + 50%, e nunca menos que 40 min). Assim, morando na cidade vizinha, as regiões mais
 * bem servidas ainda contam como boas, e na mesma cidade só as bem servidas contam.
 */
export const COMMUTE_REF = { minMin: 40, factor: 1.5 };
export const commuteRef = (bestMin: number) =>
  Math.round(Math.max(COMMUTE_REF.minMin, (Number.isFinite(bestMin) ? bestMin : 0) * COMMUTE_REF.factor));

/**
 * Sem ônibus perto, o tempo calculado é a caminhada até o trabalho (às vezes horas, na cidade vizinha). Acima disso,
 * a tela diz "sem ônibus por perto" em vez de um número sem sentido.
 */
export const FAR_WALK_MIN = 60;
export const noTransitNear = (c: { via: string; commuteMin: number }) =>
  c.via === "a pé" && c.commuteMin > FAR_WALK_MIN;
