import { describe, expect, it } from "vitest";
import type { Cell } from "@homematch/contracts";
import { bandOf, greatThreshold, showCell } from "@homematch/domain";
import { DEFAULT_MAP_SETTINGS, normalizeMapSettings } from "../src/features/map/settings";

const cell = (score: number, misses?: number): Cell => ({
  id: String(score),
  lat: 0,
  lng: 0,
  commuteMin: 30,
  via: "a pé",
  featureDist: {},
  score,
  region: "R",
  misses,
});

describe("nota das regiões no mapa", () => {
  const cells = [10, 20, 30, 40, 50, 60].map((s) => cell(s)).concat([cell(95, 1)]);

  it("ótima = terço de cima entre as áreas que atendem a tudo (quem só chega perto não conta)", () => {
    const t = greatThreshold(cells);
    expect(t).toBe(50);
    expect(cells.filter((c) => bandOf(c, t) === "great").map((c) => c.score)).toEqual([50, 60]);
    expect(bandOf(cell(95, 1), t)).toBe("ok"); // nota alta, mas falta algo
  });

  it("filtro ok / ótima / ambas", () => {
    const t = greatThreshold(cells);
    const count = (band: "great" | "ok" | "both") => cells.filter((c) => showCell(c, band, t)).length;
    expect(count("both")).toBe(7);
    expect(count("great")).toBe(2);
    expect(count("ok")).toBe(5);
    expect(greatThreshold([])).toBe(Infinity);
  });

  it("configurações antigas (só 4 camadas) ganham o resto do padrão", () => {
    const old = { routes: false, pois: true, cells: true, listings: true } as never;
    const s = normalizeMapSettings(old);
    expect(s.routes).toBe(false);
    expect(s.cellBand).toBe("both");
    expect(s.hiddenPois).toEqual([]);
    expect(normalizeMapSettings({ cellBand: "x" as never }).cellBand).toBe("both");
    expect(normalizeMapSettings(null)).toEqual(DEFAULT_MAP_SETTINGS);
  });
});
