import type { RegionLevel, TravelKind } from "@homematch/contracts";
import { REGION_LEVELS } from "@homematch/contracts/constants";
import { t } from "@homematch/i18n";

/**
 * Region levels: instead of a maximum commute, each piece of the city is judged by what the user said matters.
 * Each criterion (transit to work and each place wanted nearby) has a weight: 3 = main, 2 = important,
 * 1 = nice to have.
 *
 * - excellent: the main criterion is met and so is most of the weight (≥ 75%);
 * - good: the main criterion is met;
 * - ok: something is met, but not the main criterion;
 * - out (null): nothing is met. Listings only show up in regions with a level.
 */

export const IMPORTANCE = { main: 3, important: 2, nice: 1 } as const;
export type Importance = 1 | 2 | 3;

/** Transit criterion id (the others use the feature id). */
export const TRANSIT_CRITERION = "transit";

/** Share of the weight that must be met (together with the main criterion) for "excellent". */
export const EXCELLENT_SHARE = 0.75;

export interface CriterionResult {
  id: string;
  weight: number;
  hit: boolean;
  /** 0..1: how well it was met (0 when it was not). */
  fit: number;
}

/** The main criterion: the heaviest one (on ties, the first in the list, which is transit). */
export function mainCriterion<T extends { id: string; weight: number }>(cs: T[]): T | undefined {
  let best: T | undefined;
  for (const c of cs) if (c.weight > 0 && (!best || c.weight > best.weight)) best = c;
  return best;
}

export function levelOf(cs: CriterionResult[]): RegionLevel | null {
  const main = mainCriterion(cs);
  if (!main) return null;
  const total = cs.reduce((s, c) => s + c.weight, 0);
  const hitWeight = cs.reduce((s, c) => s + (c.hit ? c.weight : 0), 0);
  if (!hitWeight) return null;
  if (!main.hit) return "ok";
  return hitWeight / total >= EXCELLENT_SHARE ? "excellent" : "good";
}

/** Score 0–100: sum of the weights met, each scaled by how well it was met. Sorts cells within a level. */
export function criteriaScore(cs: CriterionResult[]): number {
  const total = cs.reduce((s, c) => s + c.weight, 0);
  if (!total) return 0;
  return Math.round((1000 * cs.reduce((s, c) => s + c.weight * (c.hit ? c.fit : 0), 0)) / total) / 10;
}

/** Level order: 2 = excellent, 1 = good, 0 = ok. */
export const levelRank = (l: RegionLevel | null | undefined) => (l ? REGION_LEVELS.indexOf(l) : -1);

/** The level reaches the chosen minimum (e.g. "good" shows good and excellent). */
export const atLeast = (l: RegionLevel | null | undefined, min: RegionLevel) => levelRank(l) >= levelRank(min);

/** Localized level name. */
export const levelLabel = (l: RegionLevel) => t.regions.levels[l];

/**
 * Transit without a time limit: "met" means reaching work within `refMin`, derived from the city's own best
 * transit commute (best + 50%, never below 45 min). So when living in a neighboring city the best-served regions
 * still count, and within the same city only well-served ones do.
 *
 * A direct line (one bus all the way, no transfer) is worth more than its minutes say: no missed connection, a seat
 * for the whole ride. Along it, transit counts as met up to `directRefMin` (50% more). Without this, the
 * neighborhoods along the line that stops at work, a bit farther out, fell to "ok" and out of the listing search.
 */
export const COMMUTE_REF = { minMin: 45, factor: 1.5, directFactor: 1.5 };
export const commuteRef = (bestMin: number) =>
  Math.round(Math.max(COMMUTE_REF.minMin, (Number.isFinite(bestMin) ? bestMin : 0) * COMMUTE_REF.factor));
export const directRef = (refMin: number) => Math.round(refMin * COMMUTE_REF.directFactor);

/**
 * How well the commute meets the transit criterion (0 = not met, 0.5..1 = met, 1 at the city's best). The limit is
 * `refMin`, or `directRefMin` on a direct line.
 */
export function transitFit(c: { minutes: number; direct?: boolean }, bestMin: number, refMin: number): number {
  const limit = c.direct ? directRef(refMin) : refMin;
  if (c.minutes > limit) return 0;
  return 0.5 + 0.5 * Math.max(0, Math.min(1, (limit - c.minutes) / Math.max(1, limit - bestMin)));
}

/**
 * Without a bus nearby, the computed time is the walk to work (sometimes hours, from a neighboring city). Beyond
 * this, the UI says "no bus nearby" instead of a meaningless number.
 */
export const FAR_WALK_MIN = 60;
export const noTransitNear = (c: { travel: TravelKind; commuteMin: number }) =>
  c.travel === "walk" && c.commuteMin > FAR_WALK_MIN;
