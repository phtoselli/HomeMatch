import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeType, parseBRL } from "../../src/server/listings/normalize.js";
import { buildQaBody, parseQuintoAndar, type QaResponse } from "../../src/server/listings/quintoandar.js";
import { parseVivaReal } from "../../src/server/listings/vivareal.js";

const fx = (f: string) => readFileSync(join(__dirname, "..", "fixtures", f), "utf8");

describe("normalize", () => {
  it("parseBRL", () => {
    expect(parseBRL("R$ 7.000")).toBe(7000);
    expect(parseBRL("Cond. R$ 1.605,50")).toBe(1605.5);
    expect(parseBRL("sob consulta")).toBeUndefined();
  });
  it("normalizeType", () => {
    expect(normalizeType("StudioOuKitchenette")).toBe("studio");
    expect(normalizeType("CasaCondominio")).toBe("casa_condominio");
    expect(normalizeType("Casa de Condomínio")).toBe("casa_condominio");
    expect(normalizeType("Sobrado")).toBe("casa");
    expect(normalizeType("Apartamento")).toBe("apartamento");
    expect(normalizeType("Cobertura")).toBe("apartamento");
  });
});

describe("QuintoAndar", () => {
  it("parse da API de busca (fixture real)", () => {
    const json = JSON.parse(fx("quintoandar-list.json")) as QaResponse;
    const out = parseQuintoAndar(json);
    // o 1º hit da fixture tem forRent=false e deve ser descartado
    expect(out.length).toBe(json.hits.hits.filter((h) => h._source.forRent !== false).length);
    const l = out[0]!;
    expect(l.id).toMatch(/^quintoandar:\d+$/);
    expect(l.url).toMatch(/^https:\/\/www\.quintoandar\.com\.br\/imovel\/\d+\/alugar$/);
    expect(l.rent).toBeGreaterThan(0);
    expect(l.total).toBeGreaterThanOrEqual(l.rent);
    expect(l.lat).toBeLessThan(-23);
    expect(l.approxLocation).toBe(false);
  });

  it("corpo da busca usa a bbox como viewport", () => {
    const b = buildQaBody({ south: -23.6, north: -23.5, west: -46.7, east: -46.6 }, "sao-paulo-sp-brasil", 50);
    expect(b.filters.location.viewport).toEqual({ east: -46.6, north: -23.5, south: -23.6, west: -46.7 });
    expect(b.pagination.offset).toBe(50);
    expect(b.filters.businessContext).toBe("RENT");
  });
});

describe("VivaReal", () => {
  it("parse dos cards da página de busca (fixture real)", () => {
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
