import { describe, expect, it } from "vitest";
import {
  GENERIC_BUS,
  HUB_LABEL,
  HUB_MAX_TO_WORK_MIN,
  PointIndex,
  genericBusCommute,
  hubCommute,
  hubsToWork,
  scoreGrid,
  type BoardingStop,
} from "../src/index.js";

// Cosmópolis → Campinas: terminal no caminho (Barão Geraldo) e o trabalho no centro de Campinas.
const cosmopolis = { lat: -22.6437, lng: -47.1972 };
const terminal = { lat: -22.8176, lng: -47.0727, name: "Terminal Barão Geraldo" };
const work = { lat: -22.9027, lng: -47.0479 };
const stop = (lat: number, lng: number, valueMin: number, label = "Ônibus 332"): BoardingStop => ({
  lat,
  lng,
  valueMin,
  routeId: `r-${label}`,
  label,
});

describe("intermunicipal estimado até o terminal", () => {
  it("hubsToWork: segue pela linha municipal que embarca perto do terminal", () => {
    const [hub] = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    expect(hub!.label).toBe("Ônibus 332");
    expect(hub!.routeId).toBe("r-Ônibus 332");
    expect(hub!.toWorkMin).toBeGreaterThan(35);
    expect(hub!.toWorkMin).toBeLessThan(40);
  });

  it("hubsToWork: sem linha perto, só vale se der para ir a pé dentro do limite", () => {
    expect(hubsToWork([terminal], [], work)).toHaveLength(0); // ~10 km a pé
    const nearWork = { lat: -22.9, lng: -47.05, name: "Rodoviária" };
    const [hub] = hubsToWork([nearWork], [], work);
    expect(hub!.routeId).toBeUndefined();
    expect(hub!.toWorkMin).toBeLessThan(HUB_MAX_TO_WORK_MIN);
  });

  it("hubCommute: casa → terminal por rodovia + linha municipal, com o terminal no rótulo", () => {
    const hubs = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    const stops = new PointIndex([cosmopolis], 500, cosmopolis.lat);
    const c = hubCommute(cosmopolis, stops, hubs, 800)!;
    expect(c.via).toBe(`${HUB_LABEL} até Terminal Barão Geraldo + Ônibus 332`);
    expect(c.hubId).toBe(hubs[0]!.id);
    expect(c.routeId).toBe("r-Ônibus 332");
    // Mais realista (e mais longo) do que o ônibus estimado que deixa na porta do trabalho.
    const direct = genericBusCommute(cosmopolis, work, stops, 800, 200, undefined, true)!;
    expect(c.minutes).toBeGreaterThan(direct.minutes);
    expect(c.minutes).toBeLessThan(150);
  });

  it("hubCommute: escolhe o terminal com o menor tempo total", () => {
    const far = { lat: -22.95, lng: -47.1, name: "Terminal Ouro Verde" };
    const hubs = hubsToWork(
      [far, terminal],
      [stop(-22.8178, -47.073, 35), stop(-22.95, -47.1, 20, "Ônibus 100")],
      work,
    );
    const c = hubCommute(cosmopolis, new PointIndex([cosmopolis], 500, cosmopolis.lat), hubs, 800)!;
    expect(c.via).toContain("Terminal Barão Geraldo");
  });

  it("hubCommute: sem ponto de ônibus perto de casa, não há estimativa", () => {
    const hubs = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    expect(hubCommute(cosmopolis, new PointIndex([], 500, 0), hubs, 800)).toBeNull();
  });

  it("scoreGrid: com terminais, o estimado vai até o terminal e informa quais foram usados", () => {
    const hubs = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    const box = { south: -22.66, north: -22.63, west: -47.21, east: -47.18 };
    const out = scoreGrid({
      bbox: box,
      work,
      cellSizeM: 1000,
      maxWalkToStopM: 2000,
      transitWeight: 3,
      features: [],
      pois: {},
      stops: [],
      places: [],
      fallback: { busStops: [cosmopolis], workStopDistM: 0, intercity: true },
      hubs,
    });
    expect(out.cells.length).toBeGreaterThan(0);
    expect(out.cells.every((c) => c.via.startsWith(HUB_LABEL))).toBe(true);
    expect(out.hubsUsed).toEqual([hubs[0]!.id]);
    expect(out.cells.some((c) => c.via === GENERIC_BUS.roadLabel)).toBe(false);
  });
});
