import { describe, expect, it } from "vitest";
import { PointIndex } from "@homematch/domain";
import type { OsmElement } from "../src/osm/overpass.js";
import { boardingStops, commuteFrom } from "@homematch/domain";
import { parseRoutes } from "../src/transit.js";

// Straight north → south line, stops every ~1.1 km; work is at the last stop.
const work = { lat: -23.6, lng: -46.65 };
const stopsLat = [-23.55, -23.56, -23.57, -23.58, -23.59, -23.6];

function busRoute(ptv2: boolean): OsmElement[] {
  const nodes: OsmElement[] = stopsLat.map((lat, i) => ({ type: "node", id: i + 1, lat, lon: -46.65 }));
  const rel: OsmElement = {
    type: "relation",
    id: 100,
    tags: {
      type: "route",
      route: "bus",
      ref: "875A",
      name: "875A Centro",
      ...(ptv2 ? { "public_transport:version": "2" } : {}),
    },
    members: [
      { type: "way", ref: 999, role: "" }, // track/street: ignored
      ...nodes.map((n) => ({ type: "node" as const, ref: n.id, role: "stop" })),
    ],
  };
  return [rel, ...nodes];
}

describe("transit", () => {
  it("parseRoutes orders the stops and ignores members without coordinates", () => {
    const [r] = parseRoutes(busRoute(true));
    expect(r!.ref).toBe("875A");
    expect(r!.mode).toBe("bus");
    expect(r!.path).toHaveLength(6);
    expect(r!.path[0]).toEqual([-23.55, -46.65]);
  });

  it("boardingStops: boarding farther away costs more; PTv2 respects the direction", () => {
    const stops = boardingStops(parseRoutes(busRoute(true)), work);
    // the last stop (at work) is not a useful boarding point
    expect(stops.find((s) => s.lat === -23.6)).toBeUndefined();
    const first = stops.find((s) => s.lat === -23.55)!;
    const fourth = stops.find((s) => s.lat === -23.58)!;
    expect(first.valueMin).toBeGreaterThan(fourth.valueMin);
    // ~5.5 km at 15 km/h ≈ 25 min + 8 waiting
    expect(first.valueMin).toBeGreaterThan(28);
    expect(first.valueMin).toBeLessThan(40);
  });

  it("a line without direction (PTv1) counts in both directions", () => {
    const workNorth = { lat: -23.55, lng: -46.65 };
    expect(boardingStops(parseRoutes(busRoute(true)), workNorth)).toHaveLength(0);
    expect(boardingStops(parseRoutes(busRoute(false)), workNorth).length).toBeGreaterThan(0);
  });

  it("commuteFrom picks the line when worth it and walking when close", () => {
    const idx = new PointIndex(boardingStops(parseRoutes(busRoute(true)), work), 1000);
    const far = commuteFrom({ lat: -23.551, lng: -46.651 }, work, idx, 800);
    expect(far.via).toBe("Ônibus 875A");
    expect(far.minutes).toBeLessThan(45);
    const near = commuteFrom({ lat: -23.598, lng: -46.65 }, work, idx, 800);
    expect(near.travel).toBe("walk");
  });
});

describe("transfers and alighting", () => {
  // Line A goes to work (north → south). Line B runs east to west and crosses A at -23.57.
  const lineA = {
    id: "A",
    ref: "A",
    name: "A",
    mode: "bus" as const,
    color: "#000",
    ptv2: true,
    path: stopsLat.map((lat) => [lat, -46.65] as [number, number]),
  };
  const lineB = {
    id: "B",
    ref: "B",
    name: "B",
    mode: "bus" as const,
    color: "#000",
    ptv2: true,
    path: [-46.6, -46.61, -46.62, -46.63, -46.64, -46.6505].map((lng) => [-23.57, lng] as [number, number]),
  };

  it("without transfers, line B (which does not pass near work) does not count", () => {
    const stops = boardingStops([lineA, lineB], work);
    expect(stops.some((s) => s.routeId === "B")).toBe(false);
  });

  it("with transfers, B takes you to A: the time includes both waits", () => {
    const stops = boardingStops([lineA, lineB], work, undefined, { transfers: true });
    const b0 = stops.find((s) => s.routeId === "B" && s.lng === -46.6)!;
    expect(b0).toBeDefined();
    expect(b0.label).toBe("Ônibus B + Ônibus A");
    const a3 = stops.find((s) => s.routeId === "A" && s.lat === -23.57)!;
    // 8 min waiting for B + ride + 3 of slack + value of boarding A there
    expect(b0.valueMin).toBeGreaterThan(a3.valueMin + 8 + 3);
  });

  it("an alight-only stop is not a boarding point, but you can still get off there", () => {
    const alightOnly = stopsLat.map((_, i) => i === 1);
    const stops = boardingStops([{ ...lineA, alightOnly }], work);
    expect(stops.find((s) => s.lat === -23.56)).toBeUndefined();
    expect(stops.find((s) => s.lat === -23.55)).toBeDefined();
  });
});
