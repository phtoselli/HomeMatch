import type { Listing, ListingFilters, PropertyType } from "@homematch/contracts";
import { PROPERTY_TYPES } from "@homematch/contracts/constants";
import { migrateAmenity, migratePropertyType } from "../storage/legacy.js";
import { hasAmenity, matchesFilters, type MapFilters } from "./listing-filters.js";

/** Region analysis parameters (there is no maximum commute: regions get a level from the user's priorities). */
export interface Params {
  maxWalkToStopM: number;
  cellSizeM: number;
}

/** 250 m cells: the areas on the map follow the streets near the stops instead of half-kilometer blocks. */
export const DEFAULT_PARAMS: Params = { maxWalkToStopM: 600, cellSizeM: 250 };

/**
 * Parameters saved by older versions (with a maximum commute and commute weight) still load. The cell size is not a
 * user setting: older saves had 500 m, so it always comes from the defaults.
 */
export function normalizeParams(p: Partial<Params> & Record<string, unknown>): Params {
  return {
    maxWalkToStopM: Number(p.maxWalkToStopM) || DEFAULT_PARAMS.maxWalkToStopM,
    cellSizeM: DEFAULT_PARAMS.cellSizeM,
  };
}

export type SortKey = "match" | "price" | "commute" | "area";

/** What the user is looking for (sent to the sites) + price target, sort order and amenities (in the browser). */
export interface Filters extends MapFilters {
  sort: SortKey;
  /** How much the user wants to pay per month (target). The search cap is target + slack. */
  budget?: number | null;
  /** How far above the target the user accepts, in %. */
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

/** Filters saved by older versions (no target/slack, Portuguese ids) still load. */
export function normalizeFilters(f: Partial<Filters>): Filters {
  const out = { ...DEFAULT_FILTERS, ...f };
  if (f.budget === undefined) {
    // Older versions only had the cap: it becomes the target, with no slack (the cap stays the same).
    out.budget = out.priceMax ?? null;
    out.slack = 0;
    out.sort = "match"; // the new default order
  }
  if (!["match", "price", "commute", "area"].includes(out.sort)) out.sort = "match";
  out.types = (out.types ?? []).map(migratePropertyType).filter((x) => PROPERTY_TYPES.includes(x));
  out.amenities = (out.amenities ?? []).map(migrateAmenity);
  return out;
}

/** Price cap = target + slack. */
export const ceilingOf = (budget: number | null | undefined, slack = 0) =>
  budget ? Math.round(budget * (1 + slack / 100)) : null;

/** Changes target/slack keeping the cap (priceMax) consistent. */
export function withBudget(f: Filters, budget: number | null, slack = f.slack ?? 0): Filters {
  return { ...f, budget, slack, priceMax: ceilingOf(budget, slack) };
}

/** Only the part the sites understand (the rest is applied in the browser). */
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
 * Wide search: what is sent to the sites goes a bit beyond the request (price up to +20% over the cap, one bedroom
 * less, any type). So the screen is never empty over a few reais: near misses show up as "almost there", saying why.
 */
export const WIDE = { price: 0.2, bedrooms: 1 };

export const wideFilters = (f: Filters): ListingFilters => ({
  ...searchFilters(f),
  types: [],
  priceMax: f.priceMax ? Math.round(f.priceMax * (1 + WIDE.price)) : null,
  minBedrooms: Math.max(0, f.minBedrooms - WIDE.bedrooms),
});

/** What is removed from the list for good: beyond the wide search and the fine filters (baths, parking, area). */
export function visibleListings<T extends Listing>(list: T[], f: Filters): T[] {
  const wide = wideFilters(f);
  const wanted = f.amenities ?? [];
  return list.filter(
    (l) => matchesFilters(l, wide) && !(f.hideUnknown && wanted.some((id) => hasAmenity(l, id) === undefined)),
  );
}

export const SEARCH_TYPES: PropertyType[] = ["apartment", "house", "condo_house", "studio"];

/** The price that matters to the user (total or rent only). */
export const priceOf = (l: Listing, basis: Filters["basis"]) => (basis === "rent" ? l.rent : l.total);
