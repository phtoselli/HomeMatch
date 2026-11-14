import { describe, expect, it } from "vitest";
import { amenityRank, applyFilters, hasAmenity, type MapFilters } from "../src/search/listing-filters.js";
import type { Listing } from "@homematch/contracts";

const base: Listing = {
  id: "x",
  source: "quintoandar",
  url: "https://x",
  title: "Apto",
  type: "apartamento",
  typeLabel: "Apartamento",
  rent: 1800,
  total: 2300,
  bedrooms: 2,
  lat: 0,
  lng: 0,
  approxLocation: false,
};
const comArmario = { ...base, id: "a", amenities: ["armario_cozinha", "armario_quarto"] };
const semNada = { ...base, id: "b", amenities: ["pia"] };
const semInfo = { ...base, id: "c" };
const mobiliado = { ...base, id: "d", amenities: ["mobiliado"] };
const f: MapFilters = { types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0 };

describe("comodidades no mapa", () => {
  it("hasAmenity: sim, não ou sem informação; mobiliado conta como armários", () => {
    expect(hasAmenity(comArmario, "armario_cozinha")).toBe(true);
    expect(hasAmenity(semNada, "armario_cozinha")).toBe(false);
    expect(hasAmenity(semInfo, "armario_cozinha")).toBeUndefined();
    expect(hasAmenity(mobiliado, "armario_quarto")).toBe(true);
    expect(hasAmenity(mobiliado, "pia")).toBeUndefined(); // só "mobiliado": não diz que falta pia
  });

  it("amenityRank: tem tudo (0) → sem informação (1) → falta algo (2)", () => {
    const want = ["armario_cozinha", "armario_quarto"];
    expect(amenityRank(comArmario, want)).toBe(0);
    expect(amenityRank(semInfo, want)).toBe(1);
    expect(amenityRank(semNada, want)).toBe(2);
  });

  it("applyFilters: esconde quem não tem; quem não informa só some com hideUnknown", () => {
    const all = [comArmario, semNada, semInfo, mobiliado];
    const ids = (r: Listing[]) => r.map((l) => l.id);
    expect(ids(applyFilters(all, { ...f, amenities: ["armario_cozinha"] }))).toEqual(["a", "c", "d"]);
    expect(ids(applyFilters(all, { ...f, amenities: ["armario_cozinha"], hideUnknown: true }))).toEqual(["a", "d"]);
    expect(ids(applyFilters(all, { ...f, priceMax: 2000 }))).toEqual([]);
    expect(ids(applyFilters(all, f))).toEqual(["a", "b", "c", "d"]);
  });
});
