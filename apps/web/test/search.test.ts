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
  withBudget,
  type Filters,
} from "@homematch/domain";
import { shortVia } from "../src/features/results/ListingBits";

const base: Listing = {
  id: "x",
  source: "quintoandar",
  url: "https://x",
  title: "Apto",
  type: "apartamento",
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
  featureDist: {},
  score: 80,
  region: "R",
};
const f: Filters = { ...DEFAULT_FILTERS, budget: 2300, slack: 15, priceMax: 2645, amenities: ["armario_cozinha"] };

describe("alvo de preço", () => {
  it("teto = alvo + folga, e withBudget mantém o priceMax coerente", () => {
    expect(ceilingOf(2300, 15)).toBe(2645);
    expect(ceilingOf(null, 15)).toBeNull();
    expect(withBudget(DEFAULT_FILTERS, 2000, 10).priceMax).toBe(2200);
    expect(withBudget(f, null).priceMax).toBeNull();
  });

  it("filtros salvos antes do alvo: o teto vira o alvo, sem folga, e a ordem passa a ser o match", () => {
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

describe("busca larga e quase lá", () => {
  const want = { ...f, types: ["apartamento" as const], minBedrooms: 2 };
  const near = [{ id: "atacarejo", label: "Atacarejo", radius: 2000 }];
  const okCell = { ...cell, featureDist: { atacarejo: 900 } };

  it("os sites recebem um pedido mais largo: +20% no teto, um quarto a menos, qualquer tipo", () => {
    const w = wideFilters(want);
    expect(w.priceMax).toBe(Math.round(2645 * 1.2));
    expect(w.minBedrooms).toBe(1);
    expect(w.types).toEqual([]);
    expect(wideFilters({ ...f, priceMax: null }).priceMax).toBeNull();
  });

  it("missesOf diz o que não bate, em texto curto", () => {
    expect(missesOf(base, okCell, want, 45, near)).toEqual([]);
    const m = missesOf(
      { ...base, total: 2660, bedrooms: 1, type: "casa" },
      { ...okCell, commuteMin: 52, featureDist: { atacarejo: 2600 } },
      want,
      45,
      near,
    );
    expect(m.map((x) => x.kind)).toEqual(["price", "rooms", "type", "commute", "place"]);
    expect(m[0]!.label).toMatch(/15 acima do teto$/);
    expect(m[3]!.label).toBe("52 min até o trabalho");
    expect(m[4]!.label).toBe("Atacarejo a 2,6 km");
    expect(missesOf(base, { ...okCell, featureDist: {} }, want, 45, near)[0]!.label).toBe("Atacarejo longe");
    // Armário: só conta como falta quando o anúncio diz que não tem (sem informação não pune).
    expect(missesOf(base, okCell, { ...want, amenities: ["armario_cozinha"] }, 45, near)).toEqual([]);
    expect(
      missesOf({ ...base, amenities: ["pia"] }, okCell, { ...want, amenities: ["armario_cozinha"] }, 45, near)[0]!.kind,
    ).toBe("item");
  });

  it("grupos: tudo ok > essencial ok > quase lá > outras, mesmo com nota menor", () => {
    const price = { kind: "price" as const, label: "x" };
    const place = { kind: "place" as const, label: "y" };
    const a = { l: { ...base, id: "a" }, cell, match: 60, misses: [] };
    const b = { l: { ...base, id: "b" }, cell, match: 70, misses: [place, place] }; // longe do mercado e do parque
    const c = { l: { ...base, id: "c" }, cell, match: 95, misses: [price] };
    const d = { l: { ...base, id: "d" }, cell, match: 99, misses: [price, { kind: "rooms" as const, label: "z" }] };
    expect(
      sortRanked([d, c, b, a], f)
        .map((x) => x.l.id)
        .join(""),
    ).toBe("abcd");
    expect([a, b, c, d].map((x) => tierOf(x.misses))).toEqual([0, 1, 2, 3]);
  });

  it("a lista esconde só o que passa da busca larga", () => {
    const list = [
      { ...base, id: "ok" },
      { ...base, id: "quase", total: 2900 },
      { ...base, id: "fora", total: 3300 },
    ];
    expect(visibleListings(list, want).map((l) => l.id)).toEqual(["ok", "quase"]);
  });
});

describe("busca vazia", () => {
  it("diagnose: o mais barato do mesmo tipo e quantos de outros tipos cabem no teto", () => {
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

  it("slackToReach: folga mínima para o teto alcançar o preço", () => {
    expect(slackToReach(2300, 2660)).toBe(16);
    expect(ceilingOf(2300, slackToReach(2300, 2660))! >= 2660).toBe(true);
    expect(slackToReach(2300, 2000)).toBe(0);
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
