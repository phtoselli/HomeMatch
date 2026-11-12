import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBusQuery, parseBusLines, parseBusQuery, refCandidates } from "../src/server/busline.js";
import { assertPublicUrl, extractListingInfo, infoFromUrl, sourceOf } from "../src/server/links.js";
import type { OsmElement } from "../src/server/osm/overpass.js";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("extractListingInfo", () => {
  it("QuintoAndar: coordenada exata do JSON-LD", () => {
    const i = extractListingInfo(fx("quintoandar-detail.html"), "https://www.quintoandar.com.br/imovel/894444193/alugar/kitnet-1-quarto-pinheiros-sao-paulo");
    expect(i.geo).toEqual({ lat: -23.5626807, lng: -46.6903509 });
    expect(i.rent).toBe(2900);
    expect(i.area).toBe(25);
    expect(i.bedrooms).toBe(1);
    expect(i.image).toMatch(/^https:\/\/www\.quintoandar\.com\.br\/img\//);
  });

  it("VivaReal: sem coordenada, usa o breadcrumb como endereço", () => {
    const url = "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/";
    const i = extractListingInfo(fx("vivareal-detail.html"), url);
    expect(i.geo).toBeUndefined();
    expect(i.address).toBe("Rua Cardeal Arcoverde, Pinheiros, São Paulo, SP");
    expect(i.rent).toBe(7000);
    expect(i.area).toBe(82);
  });

  it("meta tags e mapa embutido também valem", () => {
    const html = `<html><head><meta property="og:title" content="Casa 3 quartos para alugar por R$ 2.500"></head>
      <body><iframe src="https://maps.google.com/maps?q=-22.9056,-47.0608&z=15"></iframe></body></html>`;
    const i = extractListingInfo(html, "https://imobiliaria.exemplo.com.br/imovel/123");
    expect(i.geo).toEqual({ lat: -22.9056, lng: -47.0608 });
    expect(i.rent).toBe(2500);
    expect(i.bedrooms).toBe(3);
  });

  it("QuintoAndar: condomínio e IPTU do estado da página", () => {
    const html = fx("quintoandar-detail.html") +
      '<script>{"rentPrice":2900,"condoPrice":450,"condoType":"Normal","type":"StudioOuKitchenette","totalCost":3531}</script>';
    const i = extractListingInfo(html, "https://www.quintoandar.com.br/imovel/894444193/alugar");
    expect(i.condo).toBe(450);
    expect(i.iptu).toBe(181);
  });

  it("infoFromUrl: dados do próprio link quando a página bloqueia", () => {
    const i = infoFromUrl(
      "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/",
    );
    expect(i).toMatchObject({ typeWord: "apartamento", bedrooms: 2, area: 82, rent: 7000, place: "pinheiros sao paulo" });
    expect(infoFromUrl("https://www.quintoandar.com.br/imovel/1/alugar")).toBeNull();
  });

  it("sourceOf e bloqueio de rede local", () => {
    expect(sourceOf("https://www.quintoandar.com.br/imovel/1")).toBe("quintoandar");
    expect(sourceOf("https://imob.com.br/x")).toBe("outro");
    expect(() => assertPublicUrl("http://localhost:3333/api")).toThrow();
    expect(() => assertPublicUrl("http://192.168.0.10/")).toThrow();
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow();
  });
});

describe("linha de ônibus", () => {
  it("parseBusQuery reconhece número, link do OSM e link da SPTrans", () => {
    expect(parseBusQuery("875A-10")).toMatchObject({ kind: "ref", refs: ["875A-10"] });
    expect(parseBusQuery("linha 609F")).toMatchObject({ kind: "ref", refs: ["609F"] });
    expect(parseBusQuery("https://www.openstreetmap.org/relation/13380451")).toEqual({ kind: "osm", id: "13380451" });
    const sp = parseBusQuery("https://sptrans.com.br/itinerarios/linha/?cdp=170211");
    expect(sp).toMatchObject({ kind: "website", pattern: "cdp=170211($|&)" });
    expect(refCandidates("moovit.com/lines/875A-10-lapa")).toContain("875A-10");
  });

  it("buildBusQuery filtra pela bbox e aceita sufixo de variante", () => {
    const q = buildBusQuery(parseBusQuery("609F"), { south: -24, west: -47, north: -23, east: -46 });
    expect(q).toContain('["ref"~"^609F(-[0-9]+)?$",i](-24.00000,-47.00000,-23.00000,-46.00000)');
    expect(q).toContain("out geom");
  });

  it("parseBusLines monta o traçado pelas vias e nomeia as paradas", () => {
    const els: OsmElement[] = [
      {
        type: "relation",
        id: 1,
        tags: { type: "route", route: "bus", ref: "609F-21", name: "609F-21 Anhangabaú", website: "https://sptrans.com.br/itinerarios/linha/?cdp=170211" },
        members: [
          { type: "node", ref: 10, role: "stop", lat: -23.6, lon: -46.7 },
          { type: "way", ref: 20, role: "", geometry: [{ lat: -23.6, lon: -46.7 }, { lat: -23.59, lon: -46.69 }] },
          { type: "way", ref: 21, role: "", geometry: [{ lat: -23.59, lon: -46.69 }, { lat: -23.58, lon: -46.68 }] },
          { type: "node", ref: 11, role: "platform", lat: -23.58, lon: -46.68 },
        ],
      },
      { type: "relation", id: 2, tags: { type: "route", route: "bus", ref: "609F-10" }, members: [{ type: "way", ref: 30, role: "", geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] }] },
      { type: "node", id: 10, lat: -23.6, lon: -46.7, tags: { name: "Pça. A" } },
      { type: "node", id: 11, lat: -23.58, lon: -46.68, tags: { name: "Term. B" } },
    ];
    const lines = parseBusLines(els, parseBusQuery("https://sptrans.com.br/itinerarios/linha/?cdp=170211"));
    expect(lines).toHaveLength(1); // casou pelo link: a outra variante sai
    expect(lines[0]!.segments).toHaveLength(2);
    expect(lines[0]!.stops.map((s) => s.name)).toEqual(["Pça. A", "Term. B"]);
  });
});
