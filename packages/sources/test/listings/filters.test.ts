import { describe, expect, it } from "vitest";
import type { Listing, ListingFilters } from "@homematch/contracts";
import { matchesFilters } from "@homematch/domain";
import { buildQaBody } from "../../src/listings/quintoandar.js";

const base: ListingFilters = { types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0 };
const apartment: Listing = {
  id: "q:1",
  source: "quintoandar",
  url: "https://x",
  title: "Apto",
  type: "apartment",
  typeLabel: "Apartamento",
  rent: 1800,
  total: 2350,
  area: 55,
  bedrooms: 2,
  bathrooms: 1,
  parking: 1,
  lat: -22.85,
  lng: -47.05,
  approxLocation: false,
};
const bbox = { south: -22.87, north: -22.85, west: -47.06, east: -47.04 };

describe("listing filters", () => {
  it("scenario: apartment, 2 bedrooms, up to R$ 2,400 total", () => {
    const f = { ...base, types: ["apartment" as const], minBedrooms: 2, priceMax: 2400 };
    expect(matchesFilters(apartment, f)).toBe(true);
    expect(matchesFilters({ ...apartment, total: 2600 }, f)).toBe(false);
    expect(matchesFilters({ ...apartment, type: "house" }, f)).toBe(false);
    expect(matchesFilters({ ...apartment, bedrooms: 1 }, f)).toBe(false);
    expect(matchesFilters(apartment, { ...f, basis: "rent", priceMax: 2000 })).toBe(true); // rent 1800
    expect(matchesFilters(apartment, { ...base, minBathrooms: 2 })).toBe(false);
    expect(matchesFilters(apartment, { ...base, minParking: 1, minArea: 50 })).toBe(true);
    expect(matchesFilters(apartment, undefined)).toBe(true);
  });

  it("QuintoAndar gets type, bedrooms and total price in the search", () => {
    const b = buildQaBody(bbox, "campinas-sp-brasil", 0, {
      ...base,
      types: ["apartment", "house"],
      minBedrooms: 2,
      priceMax: 2400,
    });
    expect(b.filters.houseSpecs.houseTypes).toEqual(["APARTMENT", "HOUSE"]);
    expect(b.filters.houseSpecs.bedrooms).toEqual({ range: { min: 2 } });
    expect(b.filters.priceRange).toEqual([{ costType: "TOTAL_COST", range: { max: 2400 } }]);
  });

  it("without a code for condo houses or with rent-only price, that filter is not sent", () => {
    const b = buildQaBody(bbox, "campinas-sp-brasil", 0, {
      ...base,
      types: ["apartment", "condo_house"],
      basis: "rent",
      priceMax: 2000,
    });
    expect(b.filters.houseSpecs.houseTypes).toEqual([]);
    expect(b.filters.priceRange).toEqual([]);
  });
});
