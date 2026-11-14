import { describe, expect, it } from "vitest";
import { PointIndex } from "@homematch/domain";
import type { OsmElement } from "../src/osm/overpass.js";
import { boardingStops, commuteFrom } from "@homematch/domain";
import { parseRoutes } from "../src/transit.js";

// Linha reta norte → sul, paradas a cada ~1,1 km; o trabalho fica na última parada.
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

describe("baldeação e desembarque", () => {
  // Linha A vai ao trabalho (norte → sul). Linha B corre de leste a oeste e cruza A em -23.57.
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

  it("sem baldeação, a linha B (que não passa perto do trabalho) não conta", () => {
    const stops = boardingStops([lineA, lineB], work);
    expect(stops.some((s) => s.routeId === "B")).toBe(false);
  });

  it("com baldeação, B leva até a A: tempo inclui as duas esperas", () => {
    const stops = boardingStops([lineA, lineB], work, undefined, { transfers: true });
    const b0 = stops.find((s) => s.routeId === "B" && s.lng === -46.6)!;
    expect(b0).toBeDefined();
    expect(b0.label).toBe("Ônibus B + Ônibus A");
    const a3 = stops.find((s) => s.routeId === "A" && s.lat === -23.57)!;
    // 8 min de espera da B + viagem + 3 de folga + valor de embarcar na A ali
    expect(b0.valueMin).toBeGreaterThan(a3.valueMin + 8 + 3);
  });

  it("parada só de desembarque não vira ponto de embarque, mas ainda dá para descer nela", () => {
    const alightOnly = stopsLat.map((_, i) => i === 1);
    const stops = boardingStops([{ ...lineA, alightOnly }], work);
    expect(stops.find((s) => s.lat === -23.56)).toBeUndefined();
    expect(stops.find((s) => s.lat === -23.55)).toBeDefined();
  });
});
