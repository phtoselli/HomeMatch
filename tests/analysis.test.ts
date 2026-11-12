import { describe, expect, it } from "vitest";
import { analysisBBox, rankRegions, scoreGrid } from "../src/server/analysis.js";
import { buildFeatureQuery, parseFeaturePois } from "../src/server/features.js";
import { padBBox } from "../src/server/geo.js";
import type { BoardingStop } from "../src/server/transit.js";

const work = { lat: -23.6, lng: -46.65 };
// Paradas de uma linha que vai de -23.55 até o trabalho
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
  maxCommuteMin: 40,
  maxWalkToStopM: 600,
  commuteWeight: 0.7,
  stops,
  places: [
    { lat: -23.552, lng: -46.65, name: "Vila Norte", rank: 0 },
    { lat: -23.585, lng: -46.65, name: "Jardim Sul", rank: 0 },
  ],
};

describe("scoreGrid", () => {
  it("só mantém células que atendem a todas as características", () => {
    const pois = {
      parque: [{ id: "p1", feature: "parque", lat: -23.553, lng: -46.651 }],
      atacarejo: [{ id: "m1", feature: "atacarejo", lat: -23.556, lng: -46.649 }],
    };
    const out = scoreGrid({
      ...base,
      features: [
        { id: "parque", radius: 800 },
        { id: "atacarejo", radius: 1000 },
      ],
      pois,
    });
    expect(out.cells.length).toBeGreaterThan(0);
    for (const c of out.cells) {
      expect(c.featureDist.parque).toBeLessThanOrEqual(800);
      expect(c.featureDist.atacarejo).toBeLessThanOrEqual(1000);
      expect(c.commuteMin).toBeLessThanOrEqual(40);
      expect(c.region).toBe("Vila Norte");
    }
    expect(out.cellsReachable).toBeGreaterThan(out.cells.length);
  });

  it("sem características, a nota é só o trajeto (mais perto = melhor)", () => {
    const out = scoreGrid({ ...base, features: [], pois: {} });
    const regions = rankRegions(out.cells, 500);
    expect(regions[0]!.name).toBe("Jardim Sul");
    expect(regions[0]!.rank).toBe(1);
    expect(regions[0]!.commuteMin).toBeLessThanOrEqual(regions[1]!.commuteMin);
  });
});

describe("modo reserva (poucas linhas no OSM)", () => {
  it("usa pontos de ônibus para estimar o trajeto quando não há linha direta", () => {
    const sem = scoreGrid({ ...base, stops: [], features: [], pois: {}, maxCommuteMin: 60 });
    const com = scoreGrid({
      ...base,
      stops: [],
      features: [],
      pois: {},
      maxCommuteMin: 60,
      fallback: { busStops: [{ lat: -23.55, lng: -46.651 }, { lat: -23.6, lng: -46.651 }], workStopDistM: 100 },
    });
    expect(com.cells.length).toBeGreaterThan(sem.cells.length);
    expect(com.cells.some((c) => c.via === "ônibus (estimado)")).toBe(true);
  });
});

describe("consultas de características", () => {
  it("pedem coordenadas (out center), nunca `out tags`, e descartam praças", () => {
    const q = buildFeatureQuery("parque", { south: -23, west: -47, north: -22.9, east: -46.9 });
    expect(q).toMatch(/out center qt;$/);
    expect(q).not.toMatch(/out[^;]*tags/);
    const pois = parseFeaturePois("parque", [
      { type: "way", id: 1, center: { lat: -22.95, lon: -46.95 }, tags: { name: "Parque Taquaral" } },
      { type: "node", id: 2, lat: -22.95, lon: -46.96, tags: { name: "Praça Carlos Gomes" } },
      { type: "node", id: 3, tags: { name: "Sem coordenada" } },
    ]);
    expect(pois.map((p) => p.name)).toEqual(["Parque Taquaral"]);
  });
});

describe("analysisBBox", () => {
  it("corta a bbox da cidade ao alcance máximo do trajeto", () => {
    const city = { south: -24.0, north: -23.3, west: -46.9, east: -46.3 };
    const b = analysisBBox(city, work, 30); // 30 min → ~17,5 km
    expect(b.south).toBeGreaterThan(city.south);
    expect(b.north).toBeLessThan(-23.4);
  });
});
