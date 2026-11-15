import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardingStops } from "@homematch/domain";
import { buildIntercityQuery, parseIntercity } from "../src/intercity.js";
import type { OsmElement } from "../src/osm/overpass.js";

// Resposta real do Overpass para Barueri (casa) → Osasco (trabalho), reduzida: a Linha 8 da CPTM nos dois
// sentidos, 30 pontos de ônibus de Barueri e os terminais de Osasco.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/overpass-intercity-barueri-osasco.json", import.meta.url), "utf8"),
) as { elements: OsmElement[] };

// Caixas simplificadas que separam as duas cidades (as bboxes de verdade se sobrepõem).
const barueri = { bbox: { south: -23.56, north: -23.47, west: -46.95, east: -46.84 } };
const osasco = { bbox: { south: -23.58, north: -23.48, west: -46.83, east: -46.73 } };

describe("linhas intermunicipais (OpenStreetMap)", () => {
  it("a consulta pede a interseção das linhas que param nas duas cidades e os terminais do destino", () => {
    const q = buildIntercityQuery(barueri.bbox, osasco.bbox);
    expect(q).toContain("rel.ra.rb->.r;.r out geom;");
    expect(q).toContain('nwr["amenity"="bus_station"]');
    expect(q).toContain(".sa out skel qt;");
  });

  it("parseIntercity: linhas com traçado e paradas, pontos da cidade de casa e terminais", () => {
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

  it("descarta a linha que não para nas duas cidades", () => {
    const elsewhere = { bbox: { south: -23.49, north: -23.48, west: -46.8, east: -46.79 } }; // norte de Osasco, longe da linha
    expect(parseIntercity(fixture.elements, barueri, elsewhere).routes).toHaveLength(0);
  });

  it("a linha encontrada leva de Barueri até um trabalho perto da estação de Osasco", () => {
    const { routes } = parseIntercity(fixture.elements, barueri, osasco);
    const work = { lat: -23.5265, lng: -46.7765 }; // estação Osasco
    const stops = boardingStops(routes, work);
    const inBarueri = stops.filter((s) => s.lng < -46.84);
    expect(inBarueri.length).toBeGreaterThan(0);
    expect(inBarueri[0]!.label).toContain("Trem 8");
  });
});
