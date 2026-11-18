import { describe, expect, it } from "vitest";
import { t } from "@homematch/i18n";
import { PointIndex, genericBusCommute } from "../src/index.js";

describe("estimated bus (no mapped lines)", () => {
  const cosmopolis = { lat: -22.6437, lng: -47.1972 };
  const campinas = { lat: -22.9027, lng: -47.0479 }; // ~32 km as the crow flies
  const stops = new PointIndex([cosmopolis], 500, cosmopolis.lat);

  it("between cities it uses highway speed: about 1h30, like real intercity buses", () => {
    const c = genericBusCommute(cosmopolis, campinas, stops, 800, 200, undefined, true)!;
    expect(c.via).toBe(t.transit.estimatedIntercityBus);
    expect(c.travel).toBe("estimated");
    expect(c.minutes).toBeGreaterThan(75);
    expect(c.minutes).toBeLessThan(110);
  });

  it("inside the city it keeps the (slower) urban pace", () => {
    const urban = genericBusCommute(cosmopolis, campinas, stops, 800, 200)!;
    const road = genericBusCommute(cosmopolis, campinas, stops, 800, 200, undefined, true)!;
    expect(urban.via).toBe(t.transit.estimatedBus);
    expect(urban.minutes).toBeGreaterThan(road.minutes + 60);
  });
});
