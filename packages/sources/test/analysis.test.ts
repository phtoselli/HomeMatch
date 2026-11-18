import { describe, expect, it } from "vitest";
import { PointIndex, levelRank, padBBox, placeName, rankRegions, scoreGrid } from "@homematch/domain";
import type { BoardingStop } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { buildFeatureQuery, parseFeaturePois, parsePlaceNames } from "../src/features.js";

const work = { lat: -23.6, lng: -46.65 };
// Stops of a line that runs from -23.55 down to work
const stops: BoardingStop[] = [-23.55, -23.56, -23.57, -23.58].map((lat, i) => ({
  lat,
  lng: -46.65,
  valueMin: 8 + (4 - i) * 4.5,
  routeId: "1",
  label: "Ônibus 875A",
}));

const base = {
  bbox: padBBox({ south: -23.6, north: -23.55, west: -46.65, east: -46.65 }, 1500),
  work,
  cellSizeM: 500,
  maxWalkToStopM: 600,
  transitWeight: 3,
  stops,
  places: [
    { lat: -23.552, lng: -46.65, name: "Vila Norte", rank: 0 },
    { lat: -23.585, lng: -46.65, name: "Jardim Sul", rank: 0 },
  ],
};

describe("scoreGrid: levels from the priorities (no maximum time)", () => {
  const pois = {
    park: [{ id: "p1", feature: "park", lat: -23.553, lng: -46.651 }],
    wholesale_market: [{ id: "m1", feature: "wholesale_market", lat: -23.556, lng: -46.649 }],
  };

  it("transit as main priority: good/excellent where the commute is good; ok where only places match", () => {
    const out = scoreGrid({
      ...base,
      features: [
        { id: "park", radius: 800, weight: 2 },
        { id: "wholesale_market", radius: 1000, weight: 2 },
      ],
      pois,
    });
    expect(out.cells.length).toBeGreaterThan(0);
    expect(out.commuteRefMin).toBeGreaterThanOrEqual(40);
    for (const c of out.cells) {
      const transit = c.hits.includes("transit");
      if (c.level === "ok") expect(transit).toBe(false);
      else expect(transit).toBe(true);
      if (c.level === "excellent") expect(c.hits.length).toBeGreaterThanOrEqual(2);
    }
    // No time limit: areas above the old cap come in, as long as something is met.
    expect(out.levels.excellent + out.levels.good + out.levels.ok).toBe(out.cells.length);
  });

  it("a place as main priority: near it the area is good or excellent, even with a bad commute", () => {
    const out = scoreGrid({
      ...base,
      transitWeight: 1,
      features: [{ id: "park", radius: 800, weight: 3 }],
      pois,
    });
    for (const c of out.cells) {
      if (c.hits.includes("park")) expect(["good", "excellent"]).toContain(c.level);
      else expect(c.level).toBe("ok");
    }
    expect(out.cells.some((c) => c.hits.includes("park") && c.level === "excellent")).toBe(true);
  });

  it("nothing met = out (the area is left out)", () => {
    const out = scoreGrid({
      ...base,
      transitWeight: 0,
      features: [{ id: "park", radius: 300, weight: 3 }],
      pois: { park: [] },
    });
    expect(out.cells).toHaveLength(0);
  });

  it("a line chosen by the user: near its stops, transit counts as met", () => {
    const far = { ...base, stops: [], transitWeight: 3, features: [], pois: {} };
    const without = scoreGrid(far);
    const withLine = scoreGrid({ ...far, preferredStops: [{ lat: -23.55, lng: -46.65 }] });
    expect(withLine.cells.length).toBeGreaterThan(without.cells.length);
    expect(withLine.cells.every((c) => c.hits.includes("transit"))).toBe(true);
  });

  it("regions: the level comes before the score", () => {
    const out = scoreGrid({
      ...base,
      features: [{ id: "park", radius: 800, weight: 2 }],
      pois,
    });
    const regions = rankRegions(out.cells, 500);
    for (let i = 1; i < regions.length; i++)
      expect(levelRank(regions[i - 1]!.level)).toBeGreaterThanOrEqual(levelRank(regions[i]!.level));
    expect(regions[0]!.rank).toBe(1);
  });
});

describe("fallback mode (few lines in OSM)", () => {
  it("uses bus stops to estimate the commute when there is no direct line", () => {
    // A park near the northern stop keeps those areas on the map (the bus time goes over the reference).
    const out = scoreGrid({
      ...base,
      stops: [],
      features: [{ id: "park", radius: 2000, weight: 1 }],
      pois: { park: [{ id: "p1", feature: "park", lat: -23.55, lng: -46.65 }] },
      fallback: {
        busStops: [
          { lat: -23.55, lng: -46.651 },
          { lat: -23.6, lng: -46.651 },
        ],
        workStopDistM: 100,
      },
    });
    expect(out.cells.some((c) => c.via === t.transit.estimatedBus && c.travel === "estimated")).toBe(true);
  });
});

describe("feature queries", () => {
  it("ask for coordinates (out center), never `out tags`, and drop squares", () => {
    const q = buildFeatureQuery("park", { south: -23, west: -47, north: -22.9, east: -46.9 });
    expect(q).toMatch(/out center qt;$/);
    expect(q).not.toMatch(/out[^;]*tags/);
    const pois = parseFeaturePois("park", [
      { type: "way", id: 1, center: { lat: -22.95, lon: -46.95 }, tags: { name: "Parque Taquaral" } },
      { type: "node", id: 2, lat: -22.95, lon: -46.96, tags: { name: "Praça Carlos Gomes" } },
      { type: "node", id: 3, tags: { name: "Sem coordenada" } },
    ]);
    expect(pois.map((p) => p.name)).toEqual(["Parque Taquaral"]);
  });
});

describe("a long walk is not transit", () => {
  it("without buses and far from work, transit does not count as met", () => {
    const out = scoreGrid({
      ...base,
      stops: [],
      features: [{ id: "park", radius: 5000, weight: 1 }],
      pois: { park: [{ id: "p1", feature: "park", lat: -23.57, lng: -46.65 }] },
    });
    const longWalk = (c: { travel: string; commuteMin: number }) => c.travel === "walk" && c.commuteMin > 60;
    for (const c of out.cells) if (longWalk(c)) expect(c.hits).not.toContain("transit");
    expect(out.cells.some(longWalk)).toBe(true);
  });
});

describe("region names (never coordinates)", () => {
  const box = { south: -22.85, north: -22.65, west: -47.25, east: -47.05 }; // ~22 km
  const idx = (ps: { lat: number; lng: number; name: string; rank: number }[]) => new PointIndex(ps, 2000, -22.75);

  it("a nearby neighbourhood: the most important among the closest", () => {
    const places = idx([
      { lat: -22.751, lng: -47.15, name: "Loteamento X", rank: 2.5 },
      { lat: -22.752, lng: -47.151, name: "Centro", rank: 0 },
    ]);
    expect(placeName({ lat: -22.75, lng: -47.15 }, places, box, "Paulínia")).toBe("Centro");
  });

  it("no close neighbourhood: the nearest up to 6 km; none at all, the city and its side", () => {
    const places = idx([{ lat: -22.75, lng: -47.15, name: "Nova Paulínia", rank: 0 }]);
    expect(placeName({ lat: -22.785, lng: -47.15 }, places, box, "Paulínia")).toBe("Nova Paulínia"); // ~3.9 km
    expect(placeName({ lat: -22.66, lng: -47.15 }, idx([]), box, "Paulínia")).toBe("Paulínia, zona norte");
    expect(placeName({ lat: -22.84, lng: -47.06 }, idx([]), box, "Paulínia")).toBe("Paulínia, zona sudeste");
    expect(placeName({ lat: -22.75, lng: -47.15 }, idx([]), box, "Paulínia")).toBe("Paulínia, centro");
  });

  it("parsePlaceNames: official neighbourhood (boundary) and residential area with a centre; unnamed ones are left out", () => {
    const out = parsePlaceNames([
      {
        type: "relation",
        id: 1,
        center: { lat: -22.7, lon: -47.1 },
        tags: { boundary: "administrative", admin_level: "10", name: "Betel" },
      },
      {
        type: "way",
        id: 2,
        center: { lat: -22.71, lon: -47.11 },
        tags: { landuse: "residential", name: "Residencial Flora" },
      },
      { type: "way", id: 3, center: { lat: -22.72, lon: -47.12 }, tags: { landuse: "residential" } },
      { type: "node", id: 4, lat: -22.73, lon: -47.13, tags: { place: "suburb", name: "São José" } },
    ]);
    expect(out.map((p) => [p.name, p.rank])).toEqual([
      ["Betel", 0],
      ["Residencial Flora", 2.5],
      ["São José", 0],
    ]);
  });
});
