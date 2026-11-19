import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractListingInfo } from "../src/links.js";
import { addressInText, listingFromState } from "../src/listing-location.js";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("pasted link on an agency site: the property, not the agency", () => {
  const url =
    "https://www.imobiliariamelhornegocio.com.br/imoveis/apartamento-locacao-2-dormitorios-1-vaga-45m2-campinas-loteamento-residencial-parque-dos-cantos-AP17553";

  it("FlipCRM (Next.js): position and address from the listing, not the RealEstateAgent or the footer", () => {
    const i = extractListingInfo(fx("flipcrm-detail.html"), url);
    expect(i.geo).toEqual({ lat: -22.9414134, lng: -47.0238699 });
    expect(i.address).toBe(
      "Rua Professor Mauricio Francisco Ceolin, 210, Loteamento Residencial Parque dos Cantos, Campinas, SP",
    );
    expect(i.rent).toBe(1700);
    expect(i.bedrooms).toBe(2);
  });

  it("agency offices and similar listings in the app state are skipped", () => {
    const state = {
      imobiliaria: { offices: [{ name: "Matriz", latitude: -22.9, longitude: -47.04, endereco: "Rua da Matriz" }] },
      imoveisSimilares: [{ codigo: "X1", preco: 900, lat: -22.8, lon: -47.1 }],
      imovel: { codigo: "AP1", precoLocacao: 2000, dormitorios: 2, endereco: "Rua das Flores", numero: "10" },
    };
    expect(listingFromState([state])).toEqual({ geo: undefined, address: "Rua das Flores, 10" });
  });

  it("an address written in the page body", () => {
    expect(addressInText("<p>Localização: Av. Brasil, nº 1200 - Jardim Guanabara</p>")).toBe(
      "Av. Brasil, nº 1200 - Jardim Guanabara",
    );
    expect(addressInText("<p>Apartamento com 2 quartos</p>")).toBeUndefined();
  });

  it("without the listing's data, the footer map and address are not used", () => {
    const html = `<html><body><main><h1>Casa para alugar</h1></main>
      <footer>Rua Pedro Álvares Cabral, 201 - Bosque
      <iframe src="https://maps.google.com/maps?q=-22.9085304,-47.0479236"></iframe></footer></body></html>`;
    const i = extractListingInfo(html, "https://exemplo.com.br/imovel/1");
    expect(i.geo).toBeUndefined();
    expect(i.address).toBeUndefined();
  });
});
