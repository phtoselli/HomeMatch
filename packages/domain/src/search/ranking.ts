import type { Cell, Listing } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { meters, money } from "../format.js";
import { priceOf, type Filters } from "./criteria.js";
import { FILTERABLE_AMENITIES, amenityRank, hasAmenity } from "./listing-filters.js";

export type MissKind = "price" | "rooms" | "type" | "region" | "place" | "item";
/** Something in which the listing does not match the request, already as short card text. */
export interface Miss {
  kind: MissKind;
  label: string;
}

/** What the user wants near home (id, short name, radius in meters). */
export interface NearWant {
  id: string;
  label: string;
  radius: number;
}

/** Everything in which the listing does not match the request. Empty = matches everything. */
export function missesOf(l: Listing, cell: Cell | undefined, f: Filters, near: NearWant[]): Miss[] {
  const m = t.listings.misses;
  const out: Miss[] = [];
  const price = priceOf(l, f.basis);
  if (f.priceMax && price > f.priceMax) out.push({ kind: "price", label: m.overCap(money(price - f.priceMax)) });
  if (f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms) {
    out.push({ kind: "rooms", label: m.bedrooms(l.bedrooms ?? 0) });
  }
  if (f.types.length && !f.types.includes(l.type))
    out.push({ kind: "type", label: t.listings.propertyTypes[l.type] ?? l.typeLabel });
  if (!cell) out.push({ kind: "region", label: m.outsideRegions });
  else {
    for (const w of near) {
      const d = cell.featureDist[w.id];
      if (d == null) out.push({ kind: "place", label: m.placeFar(w.label) });
      else if (d > w.radius) out.push({ kind: "place", label: m.placeAt(w.label, meters(d)) });
    }
  }
  for (const id of FILTERABLE_AMENITIES) {
    if (f.amenities?.includes(id) && hasAmenity(l, id) === false)
      out.push({ kind: "item", label: m.without(t.listings.amenities[id].short) });
  }
  return out;
}

/**
 * What really weighs in the decision: price, bedrooms and being in a recommended region. Commute and what is
 * nearby are already part of the region level; type and items are wishes.
 */
export const ESSENTIAL: MissKind[] = ["price", "rooms", "region"];

/**
 * Group of a listing in the list:
 * 0 = matches everything; 1 = essentials match, something nearby or in the property is missing;
 * 2 = almost there (one essential is slightly off); 3 = other options (two or more).
 */
export function tierOf(misses: Miss[]): number {
  if (!misses.length) return 0;
  const essential = misses.filter((m) => ESSENTIAL.includes(m.kind)).length;
  return essential === 0 ? 1 : essential === 1 ? 2 : 3;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Best commute in the city and what still counts as well served (from the analysis). */
export interface CommuteRef {
  bestMin: number;
  refMin: number;
}

/**
 * How well the listing matches the search (0–100): price against the target, commute (compared with the city's
 * best), amenities confirmed in the listing and the region score (priorities met).
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
  // One bedroom less or another type: they enter the list (wide search) but lower the score.
  const roomsFit = f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms ? 0.8 : 1;
  const typeFit = f.types.length && !f.types.includes(l.type) ? 0.9 : 1;
  return Math.round(100 * (0.35 * priceFit + 0.3 * commuteFit + 0.2 * amenFit + 0.15 * areaFit) * roomsFit * typeFit);
}

/** Minimum slack (%) for the cap to reach a price. */
export const slackToReach = (budget: number, price: number) => Math.max(0, Math.ceil((price / budget - 1) * 100));

export interface Ranked {
  l: Listing;
  cell?: Cell;
  match: number;
  /** What does not match the request (empty = matches everything). */
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
  // Full matches first, then "almost there". When sorting by match, amenities are already in the score;
  // in the other orders, listings confirming the items come first.
  return [...list].sort(
    (a, b) => tierOf(a.misses) - tierOf(b.misses) || (f.sort === "match" ? 0 : rank(a) - rank(b)) || key(a) - key(b),
  );
}
