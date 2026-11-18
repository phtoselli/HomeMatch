import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractListingInfo } from "../../src/links.js";
import { detectAmenities } from "../../src/listings/normalize.js";
import { parseQuintoAndar, type QaResponse } from "../../src/listings/quintoandar.js";
import { parseVivaReal } from "../../src/listings/vivareal.js";

const fx = (f: string) => readFileSync(join(__dirname, "..", "fixtures", f), "utf8");

describe("amenities in the parsers (real fixtures)", () => {
  it("QuintoAndar list: isFurnished becomes 'furnished'; otherwise unknown", () => {
    const all = parseQuintoAndar(JSON.parse(fx("quintoandar-list.json")) as QaResponse);
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) expect(l.amenities).toEqual(l.furnished ? ["furnished"] : undefined);
  });

  it("VivaReal search: titles without amenities invent nothing", () => {
    for (const c of parseVivaReal(fx("vivareal-search.html"))) {
      expect(c.amenities === undefined || c.amenities.length > 0).toBe(true);
    }
  });

  it("QuintoAndar detail: amenityFeature (cabinets) + description ('furnished')", () => {
    const i = extractListingInfo(
      fx("quintoandar-detail.html"),
      "https://www.quintoandar.com.br/imovel/894444193/alugar",
    );
    expect(i.amenities).toEqual(["kitchen_cabinets", "wardrobe", "furnished"]);
  });

  it("VivaReal detail: 'cozinha espaçosa' does not count as cabinets", () => {
    const url =
      "https://www.vivareal.com.br/imovel/apartamento-2-quartos-pinheiros-zona-oeste-sao-paulo-com-garagem-82m2-aluguel-RS7000-id-2909698438/";
    const i = extractListingInfo(fx("vivareal-detail.html"), url);
    expect(Array.isArray(i.amenities)).toBe(true);
    expect(i.amenities).not.toContain("kitchen_cabinets");
    expect(i.amenities).not.toContain("wardrobe");
  });

  it("detail with schema.org amenityFeature", () => {
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
      "kitchen_cabinets",
      "wardrobe",
    ]);
  });
});

describe("detectAmenities", () => {
  it("kitchen cabinets", () => {
    expect(detectAmenities("Apartamento com cozinha planejada e área de serviço")).toContain("kitchen_cabinets");
    expect(detectAmenities("Possui ARMÁRIOS NA COZINHA e no banheiro")).toContain("kitchen_cabinets");
    expect(detectAmenities("armários de cozinha novos")).toContain("kitchen_cabinets");
    expect(detectAmenities("Cozinha com armários")).toContain("kitchen_cabinets");
    expect(detectAmenities("Cozinha espaçosa, área de serviço")).not.toContain("kitchen_cabinets");
  });

  it("bedroom wardrobe", () => {
    expect(detectAmenities("Dormitório com guarda-roupa")).toContain("wardrobe");
    expect(detectAmenities("guarda roupas embutido")).toContain("wardrobe");
    expect(detectAmenities("Suíte com closet")).toContain("wardrobe");
    expect(detectAmenities("armário embutido nos dois quartos")).toContain("wardrobe");
    expect(detectAmenities("Armários planejados nos dormitórios")).toContain("wardrobe");
    expect(detectAmenities("Quartos planejados")).toContain("wardrobe");
    expect(detectAmenities("02 dormitórios, sendo 01 suíte")).not.toContain("wardrobe");
  });

  it("sink / countertop and furnished", () => {
    expect(detectAmenities("Bancada de granito com cuba inox")).toContain("sink");
    expect(detectAmenities("Pia na cozinha")).toContain("sink");
    expect(detectAmenities("São 25m², mobiliado, aceita animais")).toEqual(["furnished"]);
    expect(detectAmenities("Semi-mobiliado")).toContain("furnished");
    expect(detectAmenities("Espiar a piada")).toEqual([]);
  });

  it("empty text and combinations", () => {
    expect(detectAmenities(undefined)).toEqual([]);
    expect(detectAmenities("Cozinha planejada com pia e bancada; guarda-roupa no quarto")).toEqual([
      "kitchen_cabinets",
      "wardrobe",
      "sink",
    ]);
  });
});
