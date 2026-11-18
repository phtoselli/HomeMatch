import type { AmenityId, Listing, ListingFilters } from "@homematch/contracts";
import { t } from "@homematch/i18n";

/**
 * Does the listing match what the user is looking for? Used on the server (after each site) and on the map.
 * Amenities are left out: they depend on "unknown" and are handled in the browser.
 */
export function matchesFilters(l: Listing, f: ListingFilters | undefined): boolean {
  if (!f) return true;
  const price = f.basis === "rent" ? l.rent : l.total;
  if (f.types.length && !f.types.includes(l.type)) return false;
  if (f.priceMin != null && price < f.priceMin) return false;
  if (f.priceMax != null && price > f.priceMax) return false;
  if (f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms) return false;
  if (f.minBathrooms && (l.bathrooms ?? 0) < f.minBathrooms) return false;
  if (f.minParking && (l.parking ?? 0) < f.minParking) return false;
  if (f.minArea && (l.area ?? 0) < f.minArea) return false;
  return true;
}

/** Map filters: the property ones + required amenities (with "unknown" handled separately). */
export interface MapFilters extends ListingFilters {
  /** Required `Listing.amenities` ids. */
  amenities?: AmenityId[];
  /** Hides listings that say nothing about the required amenities. */
  hideUnknown?: boolean;
}

/** Cabinets count as present when the listing is furnished. */
const CABINETS: AmenityId[] = ["kitchen_cabinets", "wardrobe"];

/** true/false when the listing says something; undefined when there is no information. */
export function hasAmenity(l: Listing, id: AmenityId): boolean | undefined {
  if (!l.amenities) return undefined;
  if (l.amenities.includes(id)) return true;
  if (CABINETS.includes(id) && l.amenities.includes("furnished")) return true;
  // Only "furnished" (QuintoAndar list, no description): we cannot say the sink is missing.
  if (l.amenities.length === 1 && l.amenities[0] === "furnished") return undefined;
  return false;
}

/** 0 = has everything requested, 1 = unknown, 2 = something is missing. */
export function amenityRank(l: Listing, wanted: AmenityId[]): number {
  let rank = 0;
  for (const id of wanted) {
    const h = hasAmenity(l, id);
    if (h === false) return 2;
    if (h === undefined) rank = 1;
  }
  return rank;
}

/** What shows up on the map and in the list. */
export function applyFilters<T extends Listing>(list: T[], f: MapFilters): T[] {
  const wanted = f.amenities ?? [];
  return list.filter((l) => {
    if (!matchesFilters(l, f)) return false;
    if (wanted.length) {
      const r = amenityRank(l, wanted);
      if (r === 2 || (r === 1 && f.hideUnknown)) return false;
    }
    return true;
  });
}

/** Amenities the user can require (detected in the listing text). */
export const FILTERABLE_AMENITIES: AmenityId[] = ["kitchen_cabinets", "wardrobe", "sink"];

/** Localized names of an amenity (full and short). */
export const amenityLabel = (id: AmenityId) => t.listings.amenities[id];
