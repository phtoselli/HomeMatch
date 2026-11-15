import { describe, expect, it } from "vitest";
import { GENERIC_BUS, PointIndex, genericBusCommute } from "../src/index.js";

describe("ônibus estimado (sem linhas mapeadas)", () => {
  const cosmopolis = { lat: -22.6437, lng: -47.1972 };
  const campinas = { lat: -22.9027, lng: -47.0479 }; // ~32 km em linha reta
  const stops = new PointIndex([cosmopolis], 500, cosmopolis.lat);

  it("entre cidades conta rodovia: perto de 1h30, como os intermunicipais de verdade", () => {
    const c = genericBusCommute(cosmopolis, campinas, stops, 800, 200, undefined, true)!;
    expect(c.via).toBe(GENERIC_BUS.roadLabel);
    expect(c.minutes).toBeGreaterThan(75);
    expect(c.minutes).toBeLessThan(110);
  });

  it("dentro da cidade continua no ritmo urbano (mais lento)", () => {
    const urban = genericBusCommute(cosmopolis, campinas, stops, 800, 200)!;
    const road = genericBusCommute(cosmopolis, campinas, stops, 800, 200, undefined, true)!;
    expect(urban.via).toBe(GENERIC_BUS.label);
    expect(urban.minutes).toBeGreaterThan(road.minutes + 60);
  });
});
