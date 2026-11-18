import { describe, expect, it } from "vitest";
import { t } from "@homematch/i18n";
import {
  HUB_MAX_TO_WORK_MIN,
  PointIndex,
  genericBusCommute,
  hubCommute,
  hubsToWork,
  scoreGrid,
  type BoardingStop,
} from "../src/index.js";

// Cosmópolis → Campinas: a terminal on the way (Barão Geraldo) and work in downtown Campinas.
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

describe("estimated intercity leg to a terminal", () => {
  it("hubsToWork: continues on the city line that boards near the terminal", () => {
    const [hub] = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    expect(hub!.label).toBe("Ônibus 332");
    expect(hub!.routeId).toBe("r-Ônibus 332");
    expect(hub!.toWorkMin).toBeGreaterThan(35);
    expect(hub!.toWorkMin).toBeLessThan(40);
  });

  it("hubsToWork: without a nearby line, it only counts when walking stays under the limit", () => {
    expect(hubsToWork([terminal], [], work)).toHaveLength(0); // ~10 km on foot
    const nearWork = { lat: -22.9, lng: -47.05, name: "Rodoviária" };
    const [hub] = hubsToWork([nearWork], [], work);
    expect(hub!.routeId).toBeUndefined();
    expect(hub!.toWorkMin).toBeLessThan(HUB_MAX_TO_WORK_MIN);
  });

  it("hubCommute: home → terminal by highway + city line, with the terminal in the label", () => {
    const hubs = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    const stops = new PointIndex([cosmopolis], 500, cosmopolis.lat);
    const c = hubCommute(cosmopolis, stops, hubs, 800)!;
    expect(c.via).toBe(t.transit.viaTerminal("Terminal Barão Geraldo", "Ônibus 332"));
    expect(c.travel).toBe("estimated");
    expect(c.hubId).toBe(hubs[0]!.id);
    expect(c.routeId).toBe("r-Ônibus 332");
    // More realistic (and longer) than the estimated bus that drops you at the work door.
    const direct = genericBusCommute(cosmopolis, work, stops, 800, 200, undefined, true)!;
    expect(c.minutes).toBeGreaterThan(direct.minutes);
    expect(c.minutes).toBeLessThan(150);
  });

  it("hubCommute: picks the terminal with the shortest total time", () => {
    const far = { lat: -22.95, lng: -47.1, name: "Terminal Ouro Verde" };
    const hubs = hubsToWork(
      [far, terminal],
      [stop(-22.8178, -47.073, 35), stop(-22.95, -47.1, 20, "Ônibus 100")],
      work,
    );
    const c = hubCommute(cosmopolis, new PointIndex([cosmopolis], 500, cosmopolis.lat), hubs, 800)!;
    expect(c.via).toContain("Terminal Barão Geraldo");
  });

  it("hubCommute: no bus stop near home means no estimate", () => {
    const hubs = hubsToWork([terminal], [stop(-22.8178, -47.073, 35)], work);
    expect(hubCommute(cosmopolis, new PointIndex([], 500, 0), hubs, 800)).toBeNull();
  });

  it("scoreGrid: with terminals, the estimate goes to the terminal and reports which ones were used", () => {
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
    const viaTerminal = t.transit.viaTerminal("Terminal Barão Geraldo");
    expect(out.cells.length).toBeGreaterThan(0);
    expect(out.cells.every((c) => c.via.startsWith(viaTerminal))).toBe(true);
    expect(out.hubsUsed).toEqual([hubs[0]!.id]);
    expect(out.cells.some((c) => c.via === t.transit.estimatedIntercityBus)).toBe(false);
  });
});
