import { describe, expect, it } from "vitest";
import type { PlaceResult } from "@homematch/contracts";
import { addressVariants, rankAddresses } from "../src/osm/nominatim.js";

describe("addressVariants", () => {
  it("endereço do Google Maps com empresa, loteamento, UF e CEP", () => {
    const v = addressVariants("Evolucional - R. Embiruçu, 185 - Lot. Alphaville Campinas, Campinas - SP, 13098-320");
    expect(v[0]).toContain("Evolucional");
    expect(v).toContain("R. Embiruçu, 185, Campinas");
    expect(v).toContain("R. Embiruçu, 185");
    expect(v).toContain("R. Embiruçu, Campinas");
    expect(v.at(-1)).toBe("R. Embiruçu");
    expect(v.some((x) => /13098|Evolucional|- SP/.test(x) && x !== v[0])).toBe(false);
  });

  it("avenida com número sem vírgula", () => {
    const v = addressVariants("Av. Paulista 1578, Bela Vista, São Paulo - SP");
    expect(v).toContain("Av. Paulista, 1578, São Paulo");
  });

  it("texto simples continua igual", () => {
    expect(addressVariants("Shopping Iguatemi Campinas")).toEqual(["Shopping Iguatemi Campinas"]);
  });
});

describe("rankAddresses (trabalho em outra cidade)", () => {
  const cosmopolis = { south: -22.7, north: -22.55, west: -47.3, east: -47.1 };
  const place = (city: string, lat: number, lng: number): PlaceResult => ({
    osmId: "W1",
    name: "Avenida Brasil",
    displayName: `Avenida Brasil, ${city}`,
    lat,
    lng,
    bbox: { south: lat, north: lat, west: lng, east: lng },
    kind: "road",
    city,
  });
  const emCosmopolis = place("Cosmópolis", -22.64, -47.19);
  const emCampinas = place("Campinas", -22.9, -47.06);
  const emPaulinia = place("Paulínia", -22.76, -47.15);

  it("a cidade escrita no endereço vem primeiro, mesmo fora da cidade escolhida", () => {
    const r = rankAddresses([emPaulinia, emCosmopolis, emCampinas], "Avenida Brasil, 500, campinas", cosmopolis);
    expect(r[0]).toBe(emCampinas);
  });

  it("sem cidade no endereço, prefere o que está na cidade onde vai morar", () => {
    const r = rankAddresses([emPaulinia, emCampinas, emCosmopolis], "Avenida Brasil, 500", cosmopolis);
    expect(r[0]).toBe(emCosmopolis);
    expect(r.slice(1)).toEqual([emPaulinia, emCampinas]);
  });
});
