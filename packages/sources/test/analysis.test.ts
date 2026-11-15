import { describe, expect, it } from "vitest";
import { rankRegions, scoreGrid } from "@homematch/domain";
import { buildFeatureQuery, parseFeaturePois } from "../src/features.js";
import { padBBox } from "@homematch/domain";
import type { BoardingStop } from "@homematch/domain";

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
  maxWalkToStopM: 600,
  transitWeight: 3,
  stops,
  places: [
    { lat: -23.552, lng: -46.65, name: "Vila Norte", rank: 0 },
    { lat: -23.585, lng: -46.65, name: "Jardim Sul", rank: 0 },
  ],
};

describe("scoreGrid: níveis pelas prioridades (sem tempo máximo)", () => {
  const pois = {
    parque: [{ id: "p1", feature: "parque", lat: -23.553, lng: -46.651 }],
    atacarejo: [{ id: "m1", feature: "atacarejo", lat: -23.556, lng: -46.649 }],
  };

  it("transporte principal: boa/excelente onde o tempo é bom; ok onde só os lugares batem", () => {
    const out = scoreGrid({
      ...base,
      features: [
        { id: "parque", radius: 800, weight: 2 },
        { id: "atacarejo", radius: 1000, weight: 2 },
      ],
      pois,
    });
    expect(out.cells.length).toBeGreaterThan(0);
    expect(out.commuteRefMin).toBeGreaterThanOrEqual(40);
    for (const c of out.cells) {
      const transit = c.hits.includes("transporte");
      if (c.level === "ok") expect(transit).toBe(false);
      else expect(transit).toBe(true);
      if (c.level === "excelente") expect(c.hits.length).toBeGreaterThanOrEqual(2);
    }
    // Sem limite de tempo: entram áreas acima do antigo teto, desde que algo seja atingido.
    expect(out.levels.excelente + out.levels.boa + out.levels.ok).toBe(out.cells.length);
  });

  it("lugar como principal: perto dele a área é boa ou excelente, mesmo com trajeto ruim", () => {
    const out = scoreGrid({
      ...base,
      transitWeight: 1,
      features: [{ id: "parque", radius: 800, weight: 3 }],
      pois,
    });
    for (const c of out.cells) {
      if (c.hits.includes("parque")) expect(["boa", "excelente"]).toContain(c.level);
      else expect(c.level).toBe("ok");
    }
    expect(out.cells.some((c) => c.hits.includes("parque") && c.level === "excelente")).toBe(true);
  });

  it("nada atingido = fora (a área não entra)", () => {
    const out = scoreGrid({
      ...base,
      transitWeight: 0,
      features: [{ id: "parque", radius: 300, weight: 3 }],
      pois: { parque: [] },
    });
    expect(out.cells).toHaveLength(0);
  });

  it("linha escolhida pela pessoa: perto dos pontos dela, o transporte conta como atingido", () => {
    const far = { ...base, stops: [], transitWeight: 3, features: [], pois: {} };
    const sem = scoreGrid(far);
    const com = scoreGrid({ ...far, preferredStops: [{ lat: -23.55, lng: -46.65 }] });
    expect(com.cells.length).toBeGreaterThan(sem.cells.length);
    expect(com.cells.every((c) => c.hits.includes("transporte"))).toBe(true);
  });

  it("regiões: o nível vem antes da nota", () => {
    const out = scoreGrid({
      ...base,
      features: [{ id: "parque", radius: 800, weight: 2 }],
      pois,
    });
    const regions = rankRegions(out.cells, 500);
    const order = { excelente: 2, boa: 1, ok: 0 } as const;
    for (let i = 1; i < regions.length; i++)
      expect(order[regions[i - 1]!.level]).toBeGreaterThanOrEqual(order[regions[i]!.level]);
    expect(regions[0]!.rank).toBe(1);
  });
});

describe("modo reserva (poucas linhas no OSM)", () => {
  it("usa pontos de ônibus para estimar o trajeto quando não há linha direta", () => {
    // Um parque perto do ponto do norte mantém as áreas de lá no mapa (o tempo de ônibus passa da referência).
    const com = scoreGrid({
      ...base,
      stops: [],
      features: [{ id: "parque", radius: 2000, weight: 1 }],
      pois: { parque: [{ id: "p1", feature: "parque", lat: -23.55, lng: -46.65 }] },
      fallback: {
        busStops: [
          { lat: -23.55, lng: -46.651 },
          { lat: -23.6, lng: -46.651 },
        ],
        workStopDistM: 100,
      },
    });
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
