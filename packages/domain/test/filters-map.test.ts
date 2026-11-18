import { describe, expect, it } from "vitest";
import { amenityRank, applyFilters, hasAmenity, type MapFilters } from "../src/search/listing-filters.js";
import type { AmenityId, Listing } from "@homematch/contracts";

const base: Listing = {
  id: "x",
  source: "quintoandar",
  url: "https://x",
  title: "Apto",
  type: "apartment",
  typeLabel: "Apartamento",
  rent: 1800,
  total: 2300,
  bedrooms: 2,
  lat: 0,
  lng: 0,
  approxLocation: false,
};
const withCabinets: Listing = { ...base, id: "a", amenities: ["kitchen_cabinets", "wardrobe"] };
const withNothing: Listing = { ...base, id: "b", amenities: ["sink"] };
const noInfo: Listing = { ...base, id: "c" };
const furnished: Listing = { ...base, id: "d", amenities: ["furnished"] };
const f: MapFilters = { types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0 };

describe("amenities on the map", () => {
  it("hasAmenity: yes, no or unknown; furnished counts as cabinets", () => {
    expect(hasAmenity(withCabinets, "kitchen_cabinets")).toBe(true);
    expect(hasAmenity(withNothing, "kitchen_cabinets")).toBe(false);
    expect(hasAmenity(noInfo, "kitchen_cabinets")).toBeUndefined();
    expect(hasAmenity(furnished, "wardrobe")).toBe(true);
    expect(hasAmenity(furnished, "sink")).toBeUndefined(); // only "furnished": it does not say the sink is missing
  });

  it("amenityRank: has everything (0) → unknown (1) → missing something (2)", () => {
    const want: AmenityId[] = ["kitchen_cabinets", "wardrobe"];
    expect(amenityRank(withCabinets, want)).toBe(0);
    expect(amenityRank(noInfo, want)).toBe(1);
    expect(amenityRank(withNothing, want)).toBe(2);
  });

  it("applyFilters: hides listings without the item; unknown ones only go with hideUnknown", () => {
    const all = [withCabinets, withNothing, noInfo, furnished];
    const ids = (r: Listing[]) => r.map((l) => l.id);
    expect(ids(applyFilters(all, { ...f, amenities: ["kitchen_cabinets"] }))).toEqual(["a", "c", "d"]);
    expect(ids(applyFilters(all, { ...f, amenities: ["kitchen_cabinets"], hideUnknown: true }))).toEqual(["a", "d"]);
    expect(ids(applyFilters(all, { ...f, priceMax: 2000 }))).toEqual([]);
    expect(ids(applyFilters(all, f))).toEqual(["a", "b", "c", "d"]);
  });
});
