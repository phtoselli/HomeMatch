import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeType, parseBRL } from "../../src/listings/normalize.js";
import { buildQaBody, parseQuintoAndar, type QaResponse } from "../../src/listings/quintoandar.js";
import { parseVivaReal } from "../../src/listings/vivareal.js";

const fx = (f: string) => readFileSync(join(__dirname, "..", "fixtures", f), "utf8");

describe("normalize", () => {
  it("parseBRL", () => {
    expect(parseBRL("R$ 7.000")).toBe(7000);
    expect(parseBRL("Cond. R$ 1.605,50")).toBe(1605.5);
    expect(parseBRL("sob consulta")).toBeUndefined();
  });
  it("normalizeType", () => {
    expect(normalizeType("StudioOuKitchenette")).toBe("studio");
    expect(normalizeType("CasaCondominio")).toBe("condo_house");
    expect(normalizeType("Casa de Condomínio")).toBe("condo_house");
    expect(normalizeType("Sobrado")).toBe("house");
    expect(normalizeType("Apartamento")).toBe("apartment");
    expect(normalizeType("Cobertura")).toBe("apartment");
  });

  it('normalizeType: the first type word wins (a "Vila …" neighbourhood or a condo does not become a house)', () => {
    expect(normalizeType("Apartamento com 2 quartos para alugar, 60m² - Vila Itapura, condomínio R$ 600")).toBe(
      "apartment",
    );
    expect(
      normalizeType(
        "Apartamento https://www.vivareal.com.br/imovel/apartamento-2-quartos-vila-industrial-campinas-60m2-aluguel-RS2200-id-1/",
      ),
    ).toBe("apartment");
    expect(normalizeType("Casa em condomínio fechado, 3 quartos")).toBe("condo_house");
    expect(normalizeType("Casa de vila no Cambuí")).toBe("condo_house");
    expect(normalizeType("Casa com 2 quartos na Vila Nova")).toBe("house");
    expect(normalizeType("Kitnet perto do apartamento modelo")).toBe("studio");
    expect(normalizeType("Sala comercial")).toBe("other");
  });
});

describe("QuintoAndar", () => {
  it("parses the search API (real fixture)", () => {
    const json = JSON.parse(fx("quintoandar-list.json")) as QaResponse;
    const out = parseQuintoAndar(json);
    // the fixture's first hit has forRent=false and must be dropped
    expect(out.length).toBe(json.hits.hits.filter((h) => h._source.forRent !== false).length);
    const l = out[0]!;
    expect(l.id).toMatch(/^quintoandar:\d+$/);
    expect(l.url).toMatch(/^https:\/\/www\.quintoandar\.com\.br\/imovel\/\d+\/alugar$/);
    expect(l.rent).toBeGreaterThan(0);
    expect(l.total).toBeGreaterThanOrEqual(l.rent);
    expect(l.lat).toBeLessThan(-23);
    expect(l.approxLocation).toBe(false);
  });

  it("the search body uses the bbox as viewport", () => {
    const b = buildQaBody({ south: -23.6, north: -23.5, west: -46.7, east: -46.6 }, "sao-paulo-sp-brasil", 50);
    expect(b.filters.location.viewport).toEqual({ east: -46.6, north: -23.5, south: -23.6, west: -46.7 });
    expect(b.pagination.offset).toBe(50);
    expect(b.filters.businessContext).toBe("RENT");
  });
});

describe("VivaReal", () => {
  it("parses the search page cards (real fixture)", () => {
    const cards = parseVivaReal(fx("vivareal-search.html"));
    expect(cards).toHaveLength(3);
    const c = cards[0]!;
    expect(c.id).toBe("2909698438");
    expect(c.url).toBe(
      "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/",
    );
    expect(c.typeLabel).toBe("Apartamento");
    expect(c.rent).toBe(7000);
    expect(c.condo).toBe(1605);
    expect(c.iptu).toBe(758);
    expect(c.area).toBe(82);
    expect(c.bedrooms).toBe(2);
    expect(c.bathrooms).toBe(2);
    expect(c.parking).toBe(2);
    expect(c.street).toBe("Rua Cardeal Arcoverde");
    expect(c.location).toBe("Pinheiros, São Paulo");
    expect(c.image).toMatch(/^https:\/\/resizedimgs\.vivareal\.com\//);
  });
});
