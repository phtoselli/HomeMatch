import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBusQuery, buildNearQuery, parseBusLines, parseBusQuery, refCandidates } from "../src/busline.js";
import { extractListingInfo, infoFromUrl, sourceOf } from "../src/links.js";
import { assertPublicUrl, isPrivateAddress } from "../src/net.js";
import type { OsmElement } from "../src/osm/overpass.js";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("extractListingInfo", () => {
  it("QuintoAndar: exact coordinates from JSON-LD", () => {
    const i = extractListingInfo(
      fx("quintoandar-detail.html"),
      "https://www.quintoandar.com.br/imovel/894444193/alugar/kitnet-1-quarto-pinheiros-sao-paulo",
    );
    expect(i.geo).toEqual({ lat: -23.5626807, lng: -46.6903509 });
    expect(i.rent).toBe(2900);
    expect(i.area).toBe(25);
    expect(i.bedrooms).toBe(1);
    expect(i.image).toMatch(/^https:\/\/www\.quintoandar\.com\.br\/img\//);
  });

  it("VivaReal: no coordinates, uses the breadcrumb as the address", () => {
    const url =
      "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/";
    const i = extractListingInfo(fx("vivareal-detail.html"), url);
    expect(i.geo).toBeUndefined();
    expect(i.address).toBe("Rua Cardeal Arcoverde, Pinheiros, São Paulo, SP");
    expect(i.rent).toBe(7000);
    expect(i.area).toBe(82);
  });

  it("meta tags and embedded maps also work", () => {
    const html = `<html><head><meta property="og:title" content="Casa 3 quartos para alugar por R$ 2.500"></head>
      <body><iframe src="https://maps.google.com/maps?q=-22.9056,-47.0608&z=15"></iframe></body></html>`;
    const i = extractListingInfo(html, "https://imobiliaria.exemplo.com.br/imovel/123");
    expect(i.geo).toEqual({ lat: -22.9056, lng: -47.0608 });
    expect(i.rent).toBe(2500);
    expect(i.bedrooms).toBe(3);
  });

  it("QuintoAndar: condo fee and IPTU from the page state", () => {
    const html =
      fx("quintoandar-detail.html") +
      '<script>{"rentPrice":2900,"condoPrice":450,"condoType":"Normal","type":"StudioOuKitchenette","totalCost":3531}</script>';
    const i = extractListingInfo(html, "https://www.quintoandar.com.br/imovel/894444193/alugar");
    expect(i.condo).toBe(450);
    expect(i.iptu).toBe(181);
  });

  it("infoFromUrl: data from the link itself when the page blocks", () => {
    const i = infoFromUrl(
      "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/",
    );
    expect(i).toMatchObject({
      typeWord: "apartamento",
      bedrooms: 2,
      area: 82,
      rent: 7000,
      place: "pinheiros sao paulo",
    });
    expect(infoFromUrl("https://www.quintoandar.com.br/imovel/1/alugar")).toBeNull();
  });

  it("sourceOf and local network blocking", () => {
    expect(sourceOf("https://www.quintoandar.com.br/imovel/1")).toBe("quintoandar");
    expect(sourceOf("https://imob.com.br/x")).toBe("other");
    expect(() => assertPublicUrl("http://localhost:3333/api")).toThrow();
    expect(() => assertPublicUrl("http://192.168.0.10/")).toThrow();
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow();
  });

  it("disguised local network (decimal, hex, IPv6 IP) is blocked too", () => {
    for (const u of [
      "http://2130706433/",
      "http://0x7f.1/",
      "http://127.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      "http://100.64.0.1/",
      "http://app.localhost/",
    ]) {
      expect(() => assertPublicUrl(u), u).toThrow();
    }
    expect(assertPublicUrl("https://www.quintoandar.com.br/imovel/1").hostname).toBe("www.quintoandar.com.br");
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("172.20.1.1")).toBe(true);
    expect(isPrivateAddress("172.32.1.1")).toBe(false);
  });
});

describe("bus line", () => {
  it("parseBusQuery recognizes a number, an OSM link and an SPTrans link", () => {
    expect(parseBusQuery("875A-10")).toMatchObject({ kind: "ref", refs: ["875A-10"] });
    expect(parseBusQuery("linha 609F")).toMatchObject({ kind: "ref", refs: ["609F"] });
    expect(parseBusQuery("https://www.openstreetmap.org/relation/13380451")).toEqual({ kind: "osm", id: "13380451" });
    const sp = parseBusQuery("https://sptrans.com.br/itinerarios/linha/?cdp=170211");
    expect(sp).toMatchObject({ kind: "website", pattern: "cdp=170211($|&)" });
    expect(refCandidates("moovit.com/lines/875A-10-lapa")).toContain("875A-10");
  });

  it("link text does not escape the quotes of the Overpass query", () => {
    const q = buildBusQuery(parseBusQuery(`https://x.com/?cdp=1"];out;rel(1);("`));
    expect(q).not.toContain(`cdp=1"`);
    expect(q).toContain(`cdp=1\\"`);
  });

  it("buildBusQuery filters by bbox and accepts a variant suffix", () => {
    const q = buildBusQuery(parseBusQuery("609F"), { south: -24, west: -47, north: -23, east: -46 });
    expect(q).toContain('["ref"~"^609F(-[0-9]+)?$",i](-24.00000,-47.00000,-23.00000,-46.00000)');
    expect(q).toContain("out geom");
  });

  it("parseBusLines builds the path from the ways and names the stops", () => {
    const els: OsmElement[] = [
      {
        type: "relation",
        id: 1,
        tags: {
          type: "route",
          route: "bus",
          ref: "609F-21",
          name: "609F-21 Anhangabaú",
          website: "https://sptrans.com.br/itinerarios/linha/?cdp=170211",
        },
        members: [
          { type: "node", ref: 10, role: "stop", lat: -23.6, lon: -46.7 },
          {
            type: "way",
            ref: 20,
            role: "",
            geometry: [
              { lat: -23.6, lon: -46.7 },
              { lat: -23.59, lon: -46.69 },
            ],
          },
          {
            type: "way",
            ref: 21,
            role: "",
            geometry: [
              { lat: -23.59, lon: -46.69 },
              { lat: -23.58, lon: -46.68 },
            ],
          },
          { type: "node", ref: 11, role: "platform", lat: -23.58, lon: -46.68 },
        ],
      },
      {
        type: "relation",
        id: 2,
        tags: { type: "route", route: "bus", ref: "609F-10" },
        members: [
          {
            type: "way",
            ref: 30,
            role: "",
            geometry: [
              { lat: 1, lon: 1 },
              { lat: 2, lon: 2 },
            ],
          },
        ],
      },
      { type: "node", id: 10, lat: -23.6, lon: -46.7, tags: { name: "Pça. A" } },
      { type: "node", id: 11, lat: -23.58, lon: -46.68, tags: { name: "Term. B" } },
    ];
    const lines = parseBusLines(els, parseBusQuery("https://sptrans.com.br/itinerarios/linha/?cdp=170211"));
    expect(lines).toHaveLength(1); // matched by link: the other variant is dropped
    expect(lines[0]!.segments).toHaveLength(2);
    expect(lines[0]!.stops.map((s) => s.name)).toEqual(["Pça. A", "Term. B"]);
  });
});

describe("lines near work (OSM)", () => {
  it("looks for stops in the radius and the routes stopping there, with geometry", () => {
    const q = buildNearQuery({ lat: -22.8213198, lng: -47.0351776 }, 700);
    expect(q).toContain("around:700,-22.821320,-47.035178");
    expect(q).toContain("rel(bn.s)");
    expect(q).toContain("out geom");
  });
  it("Line 353 without ref in OSM is found by the number in its name", () => {
    const q = buildBusQuery(parseBusQuery("353"), { south: -23, west: -47.3, north: -22.7, east: -46.8 });
    expect(q).toContain('["name"~"(^|[^0-9])353([^0-9]|$)",i]');
  });
});
