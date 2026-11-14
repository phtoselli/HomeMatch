import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractListingInfo } from "../../src/links.js";
import { detectAmenities } from "../../src/listings/normalize.js";
import { parseQuintoAndar, type QaResponse } from "../../src/listings/quintoandar.js";
import { parseVivaReal } from "../../src/listings/vivareal.js";

const fx = (f: string) => readFileSync(join(__dirname, "..", "fixtures", f), "utf8");

describe("comodidades nos parsers (fixtures reais)", () => {
  it("QuintoAndar lista: isFurnished vira 'mobiliado'; senão sem informação", () => {
    const all = parseQuintoAndar(JSON.parse(fx("quintoandar-list.json")) as QaResponse);
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) expect(l.amenities).toEqual(l.furnished ? ["mobiliado"] : undefined);
  });

  it("VivaReal busca: títulos sem comodidade não inventam nada", () => {
    for (const c of parseVivaReal(fx("vivareal-search.html"))) {
      expect(c.amenities === undefined || c.amenities.length > 0).toBe(true);
    }
  });

  it("detalhe QuintoAndar: amenityFeature (armários) + descrição ('mobiliado')", () => {
    const i = extractListingInfo(
      fx("quintoandar-detail.html"),
      "https://www.quintoandar.com.br/imovel/894444193/alugar",
    );
    expect(i.amenities).toEqual(["armario_cozinha", "armario_quarto", "mobiliado"]);
  });

  it("detalhe VivaReal: 'cozinha espaçosa' não conta como armário", () => {
    const url =
      "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/";
    const i = extractListingInfo(fx("vivareal-detail.html"), url);
    expect(Array.isArray(i.amenities)).toBe(true);
    expect(i.amenities).not.toContain("armario_cozinha");
    expect(i.amenities).not.toContain("armario_quarto");
  });

  it("detalhe com amenityFeature do schema.org", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Apartment",
      description: "Apartamento 2 dormitórios em Campinas.",
      amenityFeature: [
        { name: "Armário na cozinha", value: true },
        { name: "Guarda-roupa", value: true },
        { name: "Closet", value: false },
      ],
    })}</script>`;
    expect(extractListingInfo(html, "https://exemplo.com.br/imovel/1").amenities).toEqual([
      "armario_cozinha",
      "armario_quarto",
    ]);
  });
});

describe("detectAmenities", () => {
  it("armário na cozinha", () => {
    expect(detectAmenities("Apartamento com cozinha planejada e área de serviço")).toContain("armario_cozinha");
    expect(detectAmenities("Possui ARMÁRIOS NA COZINHA e no banheiro")).toContain("armario_cozinha");
    expect(detectAmenities("armários de cozinha novos")).toContain("armario_cozinha");
    expect(detectAmenities("Cozinha com armários")).toContain("armario_cozinha");
    expect(detectAmenities("Cozinha espaçosa, área de serviço")).not.toContain("armario_cozinha");
  });

  it("guarda-roupa no quarto", () => {
    expect(detectAmenities("Dormitório com guarda-roupa")).toContain("armario_quarto");
    expect(detectAmenities("guarda roupas embutido")).toContain("armario_quarto");
    expect(detectAmenities("Suíte com closet")).toContain("armario_quarto");
    expect(detectAmenities("armário embutido nos dois quartos")).toContain("armario_quarto");
    expect(detectAmenities("Armários planejados nos dormitórios")).toContain("armario_quarto");
    expect(detectAmenities("Quartos planejados")).toContain("armario_quarto");
    expect(detectAmenities("02 dormitórios, sendo 01 suíte")).not.toContain("armario_quarto");
  });

  it("pia / bancada e mobiliado", () => {
    expect(detectAmenities("Bancada de granito com cuba inox")).toContain("pia");
    expect(detectAmenities("Pia na cozinha")).toContain("pia");
    expect(detectAmenities("São 25m², mobiliado, aceita animais")).toEqual(["mobiliado"]);
    expect(detectAmenities("Semi-mobiliado")).toContain("mobiliado");
    expect(detectAmenities("Espiar a piada")).toEqual([]);
  });

  it("texto vazio e combinação", () => {
    expect(detectAmenities(undefined)).toEqual([]);
    expect(detectAmenities("Cozinha planejada com pia e bancada; guarda-roupa no quarto")).toEqual([
      "armario_cozinha",
      "armario_quarto",
      "pia",
    ]);
  });
});
