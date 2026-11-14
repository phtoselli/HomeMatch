import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isChallengePage, isHome, locate, sameName, toListing } from "../../src/server/listings/core/engine.js";
import { parseRobots, robotsAllows } from "../../src/server/listings/core/robots.js";
import { parseSchemaOrgListings, placeFromName } from "../../src/server/listings/core/schemaorg.js";
import { detectPlatform, findRentalLink } from "../../src/server/listings/discovery.js";
import { findNextLink } from "../../src/server/listings/extensions/agency.js";
import { chavesNaMao } from "../../src/server/listings/extensions/chavesnamao.js";
import { lopes, parseLopes } from "../../src/server/listings/extensions/lopes.js";
import { olx, parseOlx } from "../../src/server/listings/extensions/olx.js";
import { parseZap, zapImoveis } from "../../src/server/listings/extensions/zap.js";

const fx = (f: string) => readFileSync(join(__dirname, "..", "fixtures", f), "utf8");
const city = { name: "Campinas", stateCode: "SP", bbox: { south: -23.07, west: -47.25, north: -22.75, east: -46.95 } };
const region = { id: "Taquaral", name: "Parque Taquaral", lat: -22.875, lng: -47.05, bbox: { south: -22.89, west: -47.07, north: -22.86, east: -47.03 } };

describe("robots.txt", () => {
  // Trechos reais (Chaves na Mão e um site Kenlo).
  const cnm = parseRobots("User-agent: *\nAllow: /*?relatedAds=true$\nDisallow: /*?*\nDisallow: /api/\n\nUser-agent: Googlebot\nAllow: /");
  it("busca por bairro liberada, paginação com ? proibida", () => {
    expect(robotsAllows(cnm, "/imoveis-para-alugar/sp-campinas/taquaral/")).toBe(true);
    expect(robotsAllows(cnm, "/imoveis-para-alugar/sp-campinas/?pg=2")).toBe(false);
    expect(robotsAllows(cnm, "/x?relatedAds=true")).toBe(true); // Allow mais específico ganha
  });
  it("site que proíbe tudo para robôs (só o grupo * vale para nós)", () => {
    const kenlo = parseRobots("User-agent: *\nAllow: /ads.txt\nDisallow: /\n");
    expect(robotsAllows(kenlo, "/imoveis/para-alugar")).toBe(false);
    expect(robotsAllows(kenlo, "/ads.txt")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:\n"), "/aluguel/")).toBe(true);
  });
  it("padrão com * no meio só vale se a ordem bater (OLX)", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*?*estado-*\nDisallow: /q/*");
    expect(robotsAllows(r, "/imoveis/aluguel/estado-sp/campinas?o=2")).toBe(true);
    expect(robotsAllows(r, "/busca?x=estado-sp")).toBe(false);
  });
});

describe("schema.org genérico", () => {
  it("Chaves na Mão: Offer com itemOffered, coordenada e imobiliária", () => {
    const out = parseSchemaOrgListings(fx("chavesnamao-search.html"), "https://www.chavesnamao.com.br/imoveis-para-alugar/sp-campinas/");
    expect(out.length).toBe(8);
    const withGeo = out.filter((r) => r.geo);
    expect(withGeo.length).toBeGreaterThan(5);
    const casa = out.find((r) => r.id === "48086205")!;
    expect(casa.rent).toBe(19500);
    expect(casa.bedrooms).toBe(4);
    expect(casa.neighbourhood).toBe("Loteamento Alphaville Campinas");
    expect(casa.cityName).toBe("Campinas");
    expect(casa.geo).toEqual({ lat: -22.9292, lng: -47.15616 });
    expect(casa.agency).toBe("JESUS CORREA DE SOUZA");
  });

  it("Sites do Mercado: Product + offers + additionalProperty (os de venda e aluguel também valem)", () => {
    const out = parseSchemaOrgListings(fx("sitesdomercado-search.html"), "https://gallinari.com.br/imoveis/alugar/");
    expect(out.length).toBe(12);
    expect(out.every((r) => /aluguel/.test(r.url))).toBe(true);
    const casa = out.find((r) => r.title === "Casa para alugar no Jardim Dom Nery em Campinas")!;
    expect(casa).toMatchObject({ rent: 1350, bedrooms: 1, bathrooms: 1, parking: 1, typeLabel: "casa", neighbourhood: "Jardim Dom Nery", cityName: "Campinas", agency: "Imobiliária Gallinari" });
  });

  it("Kenlo: RealEstateListing com oferta de venda e de aluguel", () => {
    const out = parseSchemaOrgListings(fx("kenlo-search.html"), "https://www.merola.com.br/imoveis/para-alugar");
    expect(out.length).toBeGreaterThan(3);
    expect(out[0]!.rent).toBe(10000); // a oferta LeaseOut, não a de venda (2.000.000)
    expect(out[0]!.cityName).toBe("Vinhedo");
  });

  it("placeFromName", () => {
    expect(placeFromName("Barracão para alugar no Jardim Nossa Senhora Auxiliadora em Campinas")).toEqual({ neighbourhood: "Jardim Nossa Senhora Auxiliadora", city: "Campinas" });
    expect(placeFromName("ED. GAIVOTA - RUA CULTO A CIENCIA")).toEqual({});
  });
});

describe("extensões dos portais", () => {
  it("ZAP usa o parse do VivaReal (mesma plataforma)", () => {
    const out = parseZap(fx("zap-search.html"));
    expect(out.length).toBe(5);
    expect(out[0]!.rent).toBeGreaterThan(0);
    expect(out.every((r) => r.cityName === "Campinas")).toBe(true);
    expect(zapImoveis.url({ city, region, page: 2, filters: { types: [], priceMin: null, priceMax: 3200, basis: "total", minBedrooms: 0 } }))
      .toBe("https://www.zapimoveis.com.br/aluguel/imoveis/sp+campinas++parque-taquaral/?precoMaximo=3200&pagina=2");
  });

  it("Lopes: estado do Angular com coordenada e preços separados", () => {
    const out = parseLopes(fx("lopes-search.html"));
    expect(out.length).toBeGreaterThan(0);
    const r = out[0]!;
    expect(r.geo).toBeDefined();
    expect(r.total).toBeGreaterThanOrEqual(r.rent);
    expect(r.url).toMatch(/^https:\/\/www\.lopes\.com\.br\/imovel\/REO\d+$/);
    expect(lopes.url({ city, region, page: 1 })).toBe("https://www.lopes.com.br/busca/aluguel/br/sp/campinas/parque-taquaral");
    expect(lopes.url({ city, region, page: 2 })).toBeNull();
  });

  it("OLX: cards com bairro (sem coordenada)", () => {
    const out = parseOlx(fx("olx-search.html"));
    expect(out.length).toBe(6);
    expect(out[0]).toMatchObject({ id: "1552864424", rent: 4500, condo: 950, iptu: 150, area: 84, bedrooms: 3, bathrooms: 3, parking: 2, cityName: "Campinas", neighbourhood: "Vila Brandina" });
    expect(olx.url({ city, region, page: 3 })).toBe("https://www.olx.com.br/imoveis/aluguel/estado-sp/campinas?o=3");
  });

  it("Chaves na Mão: só a 1ª página (robots.txt) e tipo no caminho", () => {
    const f = { types: ["apartamento" as const], priceMin: null, priceMax: null, basis: "total" as const, minBedrooms: 0 };
    expect(chavesNaMao.url({ city, region, page: 1, filters: f })).toBe("https://www.chavesnamao.com.br/apartamentos-para-alugar/sp-campinas/parque-taquaral/");
    expect(chavesNaMao.url({ city, region, page: 2 })).toBeNull();
  });
});

describe("motor", () => {
  it("bairros com nome parecido casam; diferentes não", () => {
    expect(sameName("Taquaral", "Parque Taquaral")).toBe(true);
    expect(sameName("Cambuí", "cambui")).toBe(true);
    expect(sameName("Vila Brandina", "Parque Taquaral")).toBe(false);
    expect(sameName("Centro", "Jardim Centenário")).toBe(false);
  });

  it("sala, galpão e terreno não são moradia", () => {
    expect(isHome({ typeLabel: "Galpão" })).toBe(false);
    expect(isHome({ title: "Salão para alugar no Taquaral em Campinas" })).toBe(false);
    expect(isHome({ title: "Apartamento com escritório - Taquaral" })).toBe(true);
    expect(isHome({ typeLabel: "Kitnet" })).toBe(true);
  });

  it("toListing soma o total, detecta itens e põe o prefixo da fonte", () => {
    const l = toListing({ id: "1", url: "https://x", title: "Apartamento com cozinha planejada", rent: 2000, condo: 500, iptu: 80 }, { id: "site:x.com.br", label: "X" }, { lat: 1, lng: 2 }, false);
    expect(l).toMatchObject({ id: "site:x.com.br:1", source: "site:x.com.br", sourceLabel: "X", total: 2580, type: "apartamento", amenities: ["armario_cozinha"] });
  });

  it("busca pela cidade inteira: sem coordenada, só fica o anúncio do bairro da região (no centro dele)", async () => {
    const raws = [
      { id: "a", url: "https://x/a", title: "Casa", rent: 2000, neighbourhood: "Taquaral", cityName: "Campinas" },
      { id: "b", url: "https://x/b", title: "Casa", rent: 2000, neighbourhood: "Vila Brandina", cityName: "Campinas" },
      { id: "c", url: "https://x/c", title: "Casa", rent: 2000, neighbourhood: "Taquaral", cityName: "Vinhedo" },
      { id: "d", url: "https://x/d", title: "Galpão", rent: 9000, neighbourhood: "Taquaral", cityName: "Campinas" },
    ];
    const out = await locate(raws, { scope: "city" }, { city, region }, { id: "olx", label: "OLX" });
    expect(out.map((l) => l.id)).toEqual(["olx:a"]);
    expect(out[0]!.approxLocation).toBe(true);
    expect(Math.abs(out[0]!.lat - region.lat)).toBeLessThan(0.01);
  });

  it("reconhece página de desafio (Cloudflare) como bloqueio", () => {
    expect(isChallengePage("<html><head><title>Just a moment...</title>")).toBe(true);
    expect(isChallengePage(fx("chavesnamao-search.html"))).toBe(false);
  });
});

describe("descoberta de imobiliárias", () => {
  it("acha a página de aluguel na home e a plataforma", () => {
    const home = fx("sitesdomercado-home.html");
    expect(findRentalLink(home, "https://gallinari.com.br")).toBe("https://gallinari.com.br/imoveis/alugar/");
    expect(detectPlatform(home)).toBe("WordPress");
    expect(detectPlatform(fx("sitesdomercado-search.html"))).toBe("Sites do Mercado");
    expect(detectPlatform(fx("kenlo-search.html"))).toBe("Kenlo");
  });

  it("segue o link de próxima página", () => {
    expect(findNextLink(fx("sitesdomercado-search.html"), "https://gallinari.com.br/imoveis/alugar/", 1)).toBe("https://gallinari.com.br/imoveis/alugar/page/2/");
    expect(findNextLink(fx("kenlo-search.html"), "https://www.merola.com.br/imoveis/para-alugar", 1)).toBe("https://www.merola.com.br/imoveis/para-alugar?pagina=2");
    expect(findNextLink("<a href='/x?pagina=2'>", "https://a.com/x", 2)).toBeNull();
  });
});
