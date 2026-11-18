import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardingStops } from "@homematch/domain";
import { buildIntercityQuery, parseIntercity } from "../src/intercity.js";
import type { OsmElement } from "../src/osm/overpass.js";

// Real Overpass response for Barueri (home) → Osasco (work), trimmed: CPTM Line 8 in both directions,
// 30 bus stops in Barueri and the Osasco terminals.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/overpass-intercity-barueri-osasco.json", import.meta.url), "utf8"),
) as { elements: OsmElement[] };

// Simplified boxes that separate the two cities (the real bboxes overlap).
const barueri = { bbox: { south: -23.56, north: -23.47, west: -46.95, east: -46.84 } };
const osasco = { bbox: { south: -23.58, north: -23.48, west: -46.83, east: -46.73 } };

describe("intercity lines (OpenStreetMap)", () => {
  it("the query asks for the lines that stop in both cities and the destination terminals", () => {
    const q = buildIntercityQuery(barueri.bbox, osasco.bbox);
    expect(q).toMatch(/rel\.ra\([-0-9.,]+\)->\.r;\.r out geom;/);
    expect(q).toContain('nwr["amenity"="bus_station"]');
    expect(q).toContain(".sa out skel qt;");
  });

  it("parseIntercity: lines with path and stops, home city stops and terminals", () => {
    const d = parseIntercity(fixture.elements, barueri, osasco);
    expect(d.routes).toHaveLength(2);
    const r = d.routes[0]!;
    expect(r.ref).toBe("8");
    expect(r.mode).toBe("train");
    expect(r.ptv2).toBe(true);
    expect(r.path.length).toBeGreaterThan(10);
    expect(r.shape!.length).toBeGreaterThan(0);
    expect(d.homeStops).toHaveLength(30);
    expect(d.stations.length).toBeGreaterThan(3);
    expect(d.stations.map((s) => s.name)).toContain("Estação Rodoviária de Osasco");
  });

  it("drops a line that does not stop in both cities", () => {
    const elsewhere = { bbox: { south: -23.49, north: -23.48, west: -46.8, east: -46.79 } }; // north of Osasco, far from the line
    expect(parseIntercity(fixture.elements, barueri, elsewhere).routes).toHaveLength(0);
  });

  it("the line found goes from Barueri to a workplace near Osasco station", () => {
    const { routes } = parseIntercity(fixture.elements, barueri, osasco);
    const work = { lat: -23.5265, lng: -46.7765 }; // Osasco station
    const stops = boardingStops(routes, work);
    const inBarueri = stops.filter((s) => s.lng < -46.84);
    expect(inBarueri.length).toBeGreaterThan(0);
    expect(inBarueri[0]!.label).toContain("Trem 8");
  });
});
