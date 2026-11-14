import { describe, expect, it } from "vitest";
import type { Cell, Listing } from "../src/shared/types.js";
import { shortVia } from "../src/web/components/ListingBits.js";
import { makeCellLookup } from "../src/web/format.js";
import { DEFAULT_FILTERS, ceilingOf, matchScore, normalizeFilters, sortRanked, withBudget, type Filters } from "../src/web/search.js";

const base: Listing = {
  id: "x", source: "quintoandar", url: "https://x", title: "Apto", type: "apartamento", typeLabel: "Apartamento",
  rent: 2000, total: 2300, bedrooms: 2, lat: -22.85, lng: -47.05, approxLocation: false,
};
const cell: Cell = { id: "c", lat: -22.85, lng: -47.05, commuteMin: 35, via: "Ônibus 353", featureDist: {}, score: 80, region: "R" };
const f: Filters = { ...DEFAULT_FILTERS, budget: 2300, slack: 15, priceMax: 2645, amenities: ["armario_cozinha"] };

describe("alvo de preço", () => {
  it("teto = alvo + folga, e withBudget mantém o priceMax coerente", () => {
    expect(ceilingOf(2300, 15)).toBe(2645);
    expect(ceilingOf(null, 15)).toBeNull();
    expect(withBudget(DEFAULT_FILTERS, 2000, 10).priceMax).toBe(2200);
    expect(withBudget(f, null).priceMax).toBeNull();
  });

  it("filtros salvos antes do alvo: o teto vira o alvo, sem folga, e a ordem passa a ser o match", () => {
    const old = { types: [], priceMin: null, priceMax: 2600, basis: "total", minBedrooms: 2, sort: "price" } as unknown as Partial<Filters>;
    const n = normalizeFilters(old);
    expect(n.budget).toBe(2600);
    expect(n.slack).toBe(0);
    expect(n.priceMax).toBe(2600);
    expect(n.sort).toBe("match");
    expect(normalizeFilters({ ...f, sort: "price" }).sort).toBe("price"); // já no formato novo: respeita
  });
});

describe("nota de match", () => {
  it("dentro do alvo, perto e com o item pedido > acima do alvo, longe e sem informação", () => {
    const good = matchScore({ ...base, amenities: ["armario_cozinha"] }, cell, f, 45);
    const bad = matchScore({ ...base, total: 2900 }, { ...cell, commuteMin: 45, score: 40 }, f, 45);
    expect(good).toBeGreaterThan(85);
    expect(bad).toBeLessThan(good - 25);
    expect(good).toBeLessThanOrEqual(100);
  });

  it("sem célula analisada (fora da área) não zera, mas pesa contra", () => {
    const off = matchScore(base, undefined, f, 45);
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(matchScore(base, cell, f, 45));
  });

  it("ordena por match, por preço e por trajeto", () => {
    const a = { l: { ...base, id: "a", total: 2500 }, cell: { ...cell, commuteMin: 40 }, match: 70 };
    const b = { l: { ...base, id: "b", total: 2200 }, cell: { ...cell, commuteMin: 30 }, match: 90 };
    const c = { l: { ...base, id: "c", total: 2100 }, cell: undefined, match: 50 };
    const ids = (s: Filters["sort"]) => sortRanked([a, b, c], { ...f, amenities: [], sort: s }).map((x) => x.l.id).join("");
    expect(ids("match")).toBe("bac");
    expect(ids("price")).toBe("cba");
    expect(ids("commute")).toBe("bac");
  });
});

describe("apoio da interface", () => {
  it("shortVia tira o tipo do veículo", () => {
    expect(shortVia("Ônibus 353")).toBe("353");
    expect(shortVia("Ônibus 350 + Ônibus 353")).toBe("350 + 353");
    expect(shortVia("a pé")).toBe("a pé");
  });

  it("makeCellLookup aceita um raio maior para imóveis ao lado das áreas analisadas", () => {
    const cells = [cell];
    const near = { lat: cell.lat + 0.006, lng: cell.lng }; // ~670 m ao norte
    expect(makeCellLookup(cells, 500)(near)).toBeUndefined();
    expect(makeCellLookup(cells, 500, 1300)(near)?.id).toBe("c");
  });
});
