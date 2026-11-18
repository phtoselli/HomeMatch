import { describe, expect, it } from "vitest";
import type { Cell, Listing } from "@homematch/contracts";
import {
  DEFAULT_FILTERS,
  ceilingOf,
  diagnose,
  makeCellLookup,
  matchScore,
  missesOf,
  normalizeFilters,
  slackToReach,
  sortRanked,
  tierOf,
  visibleListings,
  wideFilters,
  shortVia,
  withBudget,
  type Filters,
} from "@homematch/domain";
import { t } from "@homematch/i18n";

const base: Listing = {
  id: "x",
  source: "quintoandar",
  url: "https://x",
  title: "Apto",
  type: "apartment",
  typeLabel: "Apartamento",
  rent: 2000,
  total: 2300,
  bedrooms: 2,
  lat: -22.85,
  lng: -47.05,
  approxLocation: false,
};
const cell: Cell = {
  id: "c",
  lat: -22.85,
  lng: -47.05,
  commuteMin: 35,
  via: "Ônibus 353",
  travel: "transit",
  featureDist: {},
  score: 80,
  region: "R",
  level: "good",
  hits: ["transit"],
};
const ref = { bestMin: 20, refMin: 45 };
const f: Filters = { ...DEFAULT_FILTERS, budget: 2300, slack: 15, priceMax: 2645, amenities: ["kitchen_cabinets"] };

describe("price target", () => {
  it("cap = target + slack, and withBudget keeps priceMax consistent", () => {
    expect(ceilingOf(2300, 15)).toBe(2645);
    expect(ceilingOf(null, 15)).toBeNull();
    expect(withBudget(DEFAULT_FILTERS, 2000, 10).priceMax).toBe(2200);
    expect(withBudget(f, null).priceMax).toBeNull();
  });

  it("filters saved before the target existed: the cap becomes the target, no slack, sorted by match", () => {
    const old = {
      types: [],
      priceMin: null,
      priceMax: 2600,
      basis: "total",
      minBedrooms: 2,
      sort: "price",
    } as unknown as Partial<Filters>;
    const n = normalizeFilters(old);
    expect(n.budget).toBe(2600);
    expect(n.slack).toBe(0);
    expect(n.priceMax).toBe(2600);
    expect(n.sort).toBe("match");
    expect(normalizeFilters({ ...f, sort: "price" }).sort).toBe("price"); // already in the new format: kept
  });

  it("filters saved with Portuguese ids are migrated", () => {
    const old = { ...f, types: ["apartamento", "casa"], amenities: ["armario_cozinha"] } as unknown as Partial<Filters>;
    const n = normalizeFilters(old);
    expect(n.types).toEqual(["apartment", "house"]);
    expect(n.amenities).toEqual(["kitchen_cabinets"]);
  });
});

describe("match score", () => {
  it("within target, close and with the requested item > over target, far and unknown", () => {
    const good = matchScore({ ...base, amenities: ["kitchen_cabinets"] }, cell, f, ref);
    const bad = matchScore({ ...base, total: 2900 }, { ...cell, commuteMin: 45, score: 40 }, f, ref);
    expect(good).toBeGreaterThan(85);
    expect(bad).toBeLessThan(good - 25);
    expect(good).toBeLessThanOrEqual(100);
  });

  it("no analysed cell (outside the area) does not zero it, but counts against it", () => {
    const off = matchScore(base, undefined, f, ref);
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(matchScore(base, cell, f, ref));
  });

  it("sorts by match, by price and by commute", () => {
    const a = { l: { ...base, id: "a", total: 2500 }, cell: { ...cell, commuteMin: 40 }, match: 70, misses: [] };
    const b = { l: { ...base, id: "b", total: 2200 }, cell: { ...cell, commuteMin: 30 }, match: 90, misses: [] };
    const c = { l: { ...base, id: "c", total: 2100 }, cell: undefined, match: 50, misses: [] };
    const ids = (s: Filters["sort"]) =>
      sortRanked([a, b, c], { ...f, amenities: [], sort: s })
        .map((x) => x.l.id)
        .join("");
    expect(ids("match")).toBe("bac");
    expect(ids("price")).toBe("cba");
    expect(ids("commute")).toBe("bac");
  });
});

describe("wide search and almost there", () => {
  const want = { ...f, types: ["apartment" as const], minBedrooms: 2 };
  const near = [{ id: "wholesale_market", label: "Atacarejo", radius: 2000 }];
  const okCell = { ...cell, featureDist: { wholesale_market: 900 } };

  it("the sites get a wider request: +20% on the cap, one bedroom less, any type", () => {
    const w = wideFilters(want);
    expect(w.priceMax).toBe(Math.round(2645 * 1.2));
    expect(w.minBedrooms).toBe(1);
    expect(w.types).toEqual([]);
    expect(wideFilters({ ...f, priceMax: null }).priceMax).toBeNull();
  });

  it("missesOf says what does not match, in short text", () => {
    const misses = t.listings.misses;
    expect(missesOf(base, okCell, want, near)).toEqual([]);
    const m = missesOf(
      { ...base, total: 2660, bedrooms: 1, type: "house" },
      { ...okCell, commuteMin: 52, featureDist: { wholesale_market: 2600 } },
      want,
      near,
    );
    // No maximum time: 52 min is no longer a miss (time goes into the region level).
    expect(m.map((x) => x.kind)).toEqual(["price", "rooms", "type", "place"]);
    expect(m[0]!.label).toMatch(/15 acima do teto$/);
    expect(m[3]!.label).toBe(misses.placeAt("Atacarejo", "2,6 km"));
    expect(missesOf(base, undefined, want, near)[0]!.label).toBe(misses.outsideRegions);
    expect(missesOf(base, { ...okCell, featureDist: {} }, want, near)[0]!.label).toBe(misses.placeFar("Atacarejo"));
    // Cabinets: only a miss when the listing says it has none (unknown does not count against it).
    expect(missesOf(base, okCell, { ...want, amenities: ["kitchen_cabinets"] }, near)).toEqual([]);
    expect(
      missesOf({ ...base, amenities: ["sink"] }, okCell, { ...want, amenities: ["kitchen_cabinets"] }, near)[0]!.kind,
    ).toBe("item");
  });

  it("tiers: all ok > essentials ok > almost there > others, even with a lower score", () => {
    const price = { kind: "price" as const, label: "x" };
    const place = { kind: "place" as const, label: "y" };
    const a = { l: { ...base, id: "a" }, cell, match: 60, misses: [] };
    const b = { l: { ...base, id: "b" }, cell, match: 70, misses: [place, place] }; // far from market and park
    const c = { l: { ...base, id: "c" }, cell, match: 95, misses: [price] };
    const d = { l: { ...base, id: "d" }, cell, match: 99, misses: [price, { kind: "rooms" as const, label: "z" }] };
    expect(
      sortRanked([d, c, b, a], f)
        .map((x) => x.l.id)
        .join(""),
    ).toBe("abcd");
    expect([a, b, c, d].map((x) => tierOf(x.misses))).toEqual([0, 1, 2, 3]);
  });

  it("the list only hides what goes beyond the wide search", () => {
    const list = [
      { ...base, id: "ok" },
      { ...base, id: "almost", total: 2900 },
      { ...base, id: "out", total: 3300 },
    ];
    expect(visibleListings(list, want).map((l) => l.id)).toEqual(["ok", "almost"]);
  });
});

describe("empty search", () => {
  it("diagnose: the cheapest of the same type and how many of other types fit the cap", () => {
    const same = [
      { ...base, total: 2660 },
      { ...base, total: 3100 },
    ];
    const any = [
      { ...base, type: "studio" as const, total: 1635 },
      { ...base, total: 2200 },
      { ...base, total: 3000 },
    ];
    const d = diagnose(same, any, { ...f, priceMax: 2645 });
    expect(d).toEqual({ ceiling: 2645, sameCount: 2, cheapestSame: 2660, others: 2, othersCheapest: 1635 });
    expect(diagnose([], [], f).cheapestSame).toBeUndefined();
  });

  it("slackToReach: minimum slack for the cap to reach the price", () => {
    expect(slackToReach(2300, 2660)).toBe(16);
    expect(ceilingOf(2300, slackToReach(2300, 2660))! >= 2660).toBe(true);
    expect(slackToReach(2300, 2000)).toBe(0);
  });
});

describe("UI helpers", () => {
  it("shortVia drops the vehicle type", () => {
    expect(shortVia("Ônibus 353")).toBe("353");
    expect(shortVia("Ônibus 350 + Ônibus 353")).toBe("350 + 353");
    expect(shortVia(t.transit.onFoot)).toBe(t.transit.onFoot);
  });

  it("makeCellLookup accepts a larger radius for listings next to the analysed areas", () => {
    const cells = [cell];
    const near = { lat: cell.lat + 0.006, lng: cell.lng }; // ~670 m north
    expect(makeCellLookup(cells, 500)(near)).toBeUndefined();
    expect(makeCellLookup(cells, 500, 1300)(near)?.id).toBe("c");
  });
});
