import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStateListings } from "../../src/listings/core/appstate.js";
import { isDetailPage, parseListingCards } from "../../src/listings/core/cards.js";
import { parseSchemaOrgListings } from "../../src/listings/core/schemaorg.js";
import { agencyFromUrl, findRentalLink, rentalPagesFromUrls, siteName } from "../../src/listings/discovery.js";
import { agencyExtension, parseAgencyPage } from "../../src/listings/extensions/agency.js";

const fx = (f: string) => readFileSync(join(__dirname, "..", "fixtures", f), "utf8");

describe("agency rentals page from the app state (FlipCRM, Next.js)", () => {
  const url = "https://www.imobiliariamelhornegocio.com.br/buscar/locacao/campinas-sp-brasil";

  it("reads the results list, not the agency's offices", () => {
    const list = parseStateListings(fx("flipcrm-search.html"), url);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      id: "AP17582",
      url: "https://www.imobiliariamelhornegocio.com.br/imoveis/apartamento-locacao-3-dormitorios-1-vaga-70m2-campinas-jardim-nova-europa-AP17582",
      typeLabel: "Apartamento",
      rent: 2000,
      condo: 550,
      area: 70,
      bedrooms: 3,
      bathrooms: 2,
      parking: 1,
      street: "Rua Ubatuba, 140",
      neighbourhood: "Jardim Nova Europa",
      cityName: "Campinas",
      geo: { lat: -22.9352058, lng: -47.05829929999999 },
    });
  });

  it("parseAgencyPage falls back to it when there is no schema.org", () => {
    expect(parseAgencyPage(fx("flipcrm-search.html"), url)).toHaveLength(3);
  });

  it("neighborhood from the title when the state has none, without the code prefix", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        list: [1, 2].map((i) => ({
          code: `20${i}`,
          url: `/imovel/apartamento-para-alugar-cod-20${i}`,
          title: "Apartamento para Alugar - Jardim Belo Horizonte, Campinas/ SP",
          price: 3000 + i,
          bedrooms: 2,
          area: 70,
          neighborhood: i === 1 ? `Cód. 20${i} Cambuí` : undefined,
        })),
      },
    })}</script>`;
    const list = parseStateListings(html, "https://exemplo.com.br/alugar/sp/campinas");
    expect(list.map((x) => [x.neighbourhood, x.cityName])).toEqual([
      ["Cambuí", "Campinas"],
      ["Jardim Belo Horizonte", "Campinas"],
    ]);
  });
});

describe("agency rentals page made of HTML cards (Union)", () => {
  const url = "https://www.videimoveis.com.br/alugar/sp/campinas";

  it("one listing per card, with rent, rooms and neighborhood; header links are not cards", () => {
    const list = parseListingCards(fx("union-search.html"), url);
    expect(list.length).toBe(3);
    for (const x of list) {
      expect(x.url).toMatch(/^https:\/\/www\.videimoveis\.com\.br\/(alugar|comprar-ou-alugar)\/sp\/campinas\//);
      expect(x.rent).toBeGreaterThan(100);
      expect(Number.isInteger(x.rent)).toBe(true);
      expect(x.cityName).toBe("Campinas");
    }
    expect(list.map((x) => x.id)).not.toContain("13312540");
  });
});

describe("schema.org link without the scheme (Arbo)", () => {
  it("www.site.com.br/… is the site, not a relative path", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "ItemList",
      itemListElement: [
        {
          item: {
            "@type": "RealEstateListing",
            "@id": "www.homehunters.com.br/imovel/apartamento-para-alugar/AP7713_HH#listing",
            name: "Apartamento 2 quartos para alugar no Vitória Régia",
            offers: { "@type": "Offer", price: 1500, businessFunction: "LeaseOut" },
          },
        },
      ],
    })}</script>`;
    const [x] = parseSchemaOrgListings(html, "https://www.homehunters.com.br/imoveis/para-alugar/campinas-sp");
    expect(x!.url).toBe("https://www.homehunters.com.br/imovel/apartamento-para-alugar/AP7713_HH#listing");
  });
});

describe("finding an agency's rentals pages", () => {
  it("a property page is not the rentals page", () => {
    expect(isDetailPage("https://www.homehunters.com.br/imovel/apartamento/locacao/campinas/sp/cambui/AP3792_HH")).toBe(
      true,
    );
    expect(isDetailPage("https://www.videimoveis.com.br/alugar/sp/campinas/cambui/apartamento/13312540")).toBe(true);
    expect(isDetailPage("https://x.com.br/imovel/casa-para-alugar-centro-campinas-sp-cod-203876")).toBe(true);
    expect(isDetailPage("https://www.videimoveis.com.br/alugar/sp/campinas")).toBe(false);
    expect(isDetailPage("https://www.imobiliariamelhornegocio.com.br/buscar/locacao/campinas-sp-brasil")).toBe(false);
    const home = `<a href="/imovel/apartamento/locacao/campinas/sp/cambui/AP3792_HH">Destaque</a>`;
    expect(findRentalLink(home, "https://www.homehunters.com.br")).toBeNull();
  });

  it("the city's page and one page per neighborhood from the sitemap", () => {
    const flip = rentalPagesFromUrls(
      [
        "https://m.com.br/buscar/venda/campinas-sp-brasil/cambui",
        "https://m.com.br/buscar/locacao/campinas-sp-brasil",
        "https://m.com.br/buscar/locacao/campinas-sp-brasil/parque-taquaral",
        "https://m.com.br/buscar/locacao/valinhos-sp-brasil/vila-pagano",
      ],
      "campinas",
    );
    expect(flip).toEqual({
      city: "https://m.com.br/buscar/locacao/campinas-sp-brasil",
      regions: [{ name: "parque taquaral", url: "https://m.com.br/buscar/locacao/campinas-sp-brasil/parque-taquaral" }],
    });
    const arbo = rentalPagesFromUrls(
      [
        "https://h.com.br/imoveis/para-alugar/campinas-sp",
        "https://h.com.br/imoveis/para-alugar/apartamento/campinas-sp",
        "https://h.com.br/imoveis/para-alugar/bonfim-campinas-sp",
      ],
      "campinas",
    );
    expect(arbo.regions).toEqual([{ name: "bonfim", url: "https://h.com.br/imoveis/para-alugar/bonfim-campinas-sp" }]);
  });

  it("the extension reads the neighborhood's page when there is one", () => {
    const ext = agencyExtension({
      id: "site:m.com.br",
      label: "M",
      site: "https://m.com.br",
      listingsUrl: "https://m.com.br/buscar/locacao/campinas-sp-brasil",
      regionPages: [
        { name: "parque taquaral", url: "https://m.com.br/buscar/locacao/campinas-sp-brasil/parque-taquaral" },
      ],
    });
    const at = (name: string) =>
      ext.url({
        page: 1,
        city: { name: "Campinas", stateCode: "SP", bbox: { south: 0, west: 0, north: 1, east: 1 } },
        region: { id: name, name, lat: 0, lng: 0, bbox: { south: 0, west: 0, north: 1, east: 1 } },
      });
    expect(at("Taquaral")).toBe("https://m.com.br/buscar/locacao/campinas-sp-brasil/parque-taquaral");
    expect(at("Cambuí")).toBe("https://m.com.br/buscar/locacao/campinas-sp-brasil");
  });

  it("agency sites typed by the user", () => {
    expect(agencyFromUrl("www.imobiliariamelhornegocio.com.br/buscar")).toEqual({
      name: "imobiliariamelhornegocio.com.br",
      site: "https://www.imobiliariamelhornegocio.com.br",
    });
    expect(agencyFromUrl("ftp://x.com")).toBeNull();
    expect(agencyFromUrl("localhost")).toBeNull();
    expect(siteName("<title>Bonon &amp; Amaral Imóveis | Casas</title>")).toBe("Bonon & Amaral Imóveis");
  });
});
