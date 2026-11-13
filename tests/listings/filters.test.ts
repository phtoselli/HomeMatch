import { describe, expect, it } from "vitest";
import type { Listing, ListingFilters } from "../../src/shared/types.js";
import { matchesFilters } from "../../src/server/listings/normalize.js";
import { buildQaBody } from "../../src/server/listings/quintoandar.js";

const base: ListingFilters = { types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0 };
const apto: Listing = {
  id: "q:1", source: "quintoandar", url: "https://x", title: "Apto", type: "apartamento", typeLabel: "Apartamento",
  rent: 1800, total: 2350, area: 55, bedrooms: 2, bathrooms: 1, parking: 1, lat: -22.85, lng: -47.05, approxLocation: false,
};
const bbox = { south: -22.87, north: -22.85, west: -47.06, east: -47.04 };

describe("filtros do imóvel", () => {
  it("cenário: apartamento, 2 quartos, até R$ 2.400 no total", () => {
    const f = { ...base, types: ["apartamento" as const], minBedrooms: 2, priceMax: 2400 };
    expect(matchesFilters(apto, f)).toBe(true);
    expect(matchesFilters({ ...apto, total: 2600 }, f)).toBe(false);
    expect(matchesFilters({ ...apto, type: "casa" }, f)).toBe(false);
    expect(matchesFilters({ ...apto, bedrooms: 1 }, f)).toBe(false);
    expect(matchesFilters(apto, { ...f, basis: "rent", priceMax: 2000 })).toBe(true); // aluguel 1800
    expect(matchesFilters(apto, { ...base, minBathrooms: 2 })).toBe(false);
    expect(matchesFilters(apto, { ...base, minParking: 1, minArea: 50 })).toBe(true);
    expect(matchesFilters(apto, undefined)).toBe(true);
  });

  it("QuintoAndar recebe tipo, quartos e preço total na busca", () => {
    const b = buildQaBody(bbox, "campinas-sp-brasil", 0, { ...base, types: ["apartamento", "casa"], minBedrooms: 2, priceMax: 2400 });
    expect(b.filters.houseSpecs.houseTypes).toEqual(["APARTMENT", "HOUSE"]);
    expect(b.filters.houseSpecs.bedrooms).toEqual({ range: { min: 2 } });
    expect(b.filters.priceRange).toEqual([{ costType: "TOTAL_COST", range: { max: 2400 } }]);
  });

  it("sem código para casa de condomínio ou com preço só do aluguel, não manda esse filtro", () => {
    const b = buildQaBody(bbox, "campinas-sp-brasil", 0, { ...base, types: ["apartamento", "casa_condominio"], basis: "rent", priceMax: 2000 });
    expect(b.filters.houseSpecs.houseTypes).toEqual([]);
    expect(b.filters.priceRange).toEqual([]);
  });
});
