import { describe, expect, it } from "vitest";
import { addressVariants } from "../src/server/osm/nominatim.js";

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
