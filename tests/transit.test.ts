import { describe, expect, it } from "vitest";
import { PointIndex } from "../src/server/geo.js";
import type { OsmElement } from "../src/server/osm/overpass.js";
import { boardingStops, commuteFrom, parseRoutes } from "../src/server/transit.js";

// Linha reta norte → sul, paradas a cada ~1,1 km; o trabalho fica na última parada.
const work = { lat: -23.6, lng: -46.65 };
const stopsLat = [-23.55, -23.56, -23.57, -23.58, -23.59, -23.6];

function busRoute(ptv2: boolean): OsmElement[] {
  const nodes: OsmElement[] = stopsLat.map((lat, i) => ({ type: "node", id: i + 1, lat, lon: -46.65 }));
  const rel: OsmElement = {
    type: "relation",
    id: 100,
    tags: { type: "route", route: "bus", ref: "875A", name: "875A Centro", ...(ptv2 ? { "public_transport:version": "2" } : {}) },
    members: [
      { type: "way", ref: 999, role: "" }, // trilho/rua: ignorado
      ...nodes.map((n) => ({ type: "node" as const, ref: n.id, role: "stop" })),
    ],
  };
  return [rel, ...nodes];
}

describe("transit", () => {
  it("parseRoutes ordena as paradas e ignora membros sem coordenada", () => {
    const [r] = parseRoutes(busRoute(true));
    expect(r!.ref).toBe("875A");
    expect(r!.mode).toBe("bus");
    expect(r!.path).toHaveLength(6);
    expect(r!.path[0]).toEqual([-23.55, -46.65]);
  });

  it("boardingStops: embarcar mais longe custa mais; PTv2 respeita o sentido", () => {
    const stops = boardingStops(parseRoutes(busRoute(true)), work);
    // a última parada (no trabalho) não é ponto de embarque útil
    expect(stops.find((s) => s.lat === -23.6)).toBeUndefined();
    const first = stops.find((s) => s.lat === -23.55)!;
    const fourth = stops.find((s) => s.lat === -23.58)!;
    expect(first.valueMin).toBeGreaterThan(fourth.valueMin);
    // ~5,5 km a 15 km/h ≈ 25 min + 8 de espera
    expect(first.valueMin).toBeGreaterThan(28);
    expect(first.valueMin).toBeLessThan(40);
  });

  it("linha sem sentido (PTv1) é considerada nos dois sentidos", () => {
    const workNorth = { lat: -23.55, lng: -46.65 };
    expect(boardingStops(parseRoutes(busRoute(true)), workNorth)).toHaveLength(0);
    expect(boardingStops(parseRoutes(busRoute(false)), workNorth).length).toBeGreaterThan(0);
  });

  it("commuteFrom escolhe a linha quando compensa e a caminhada quando está perto", () => {
    const idx = new PointIndex(boardingStops(parseRoutes(busRoute(true)), work), 1000);
    const far = commuteFrom({ lat: -23.551, lng: -46.651 }, work, idx, 800);
    expect(far.via).toBe("Ônibus 875A");
    expect(far.minutes).toBeLessThan(45);
    const near = commuteFrom({ lat: -23.598, lng: -46.65 }, work, idx, 800);
    expect(near.via).toBe("a pé");
  });
});
