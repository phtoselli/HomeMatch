import { describe, expect, it } from "vitest";
import { atLeast, levelOf, levelRank } from "@homematch/domain";
import { DEFAULT_MAP_SETTINGS, normalizeMapSettings } from "@/features/map/model/settings";
import { importanceOf, mainOf, setImportance } from "@/features/search/model/search";

describe("níveis das regiões", () => {
  const c = (id: string, weight: number, hit: boolean) => ({ id, weight, hit, fit: hit ? 1 : 0 });

  it("excelente = principal + maior parte do peso; boa = principal; ok = outra coisa; fora = nada", () => {
    expect(levelOf([c("transporte", 3, true), c("parque", 2, true), c("mercado", 1, false)])).toBe("excelente");
    expect(levelOf([c("transporte", 3, true), c("parque", 2, false), c("mercado", 2, false)])).toBe("boa");
    expect(levelOf([c("transporte", 3, false), c("parque", 2, true)])).toBe("ok");
    expect(levelOf([c("transporte", 3, false), c("parque", 2, false)])).toBeNull();
    expect(levelOf([c("parque", 3, true)])).toBe("excelente"); // só um critério
  });

  it("filtro de nível mínimo", () => {
    expect(atLeast("excelente", "boa")).toBe(true);
    expect(atLeast("ok", "boa")).toBe(false);
    expect(atLeast("ok", "ok")).toBe(true);
    expect(levelRank("excelente")).toBeGreaterThan(levelRank("boa"));
  });

  it("configurações antigas (só 4 camadas, com faixa de nota) ganham o resto do padrão", () => {
    const old = { routes: false, pois: true, cells: true, listings: true, cellBand: "great" } as never;
    const s = normalizeMapSettings(old);
    expect(s.routes).toBe(false);
    expect("cellBand" in s).toBe(false);
    expect(s.hiddenPois).toEqual([]);
    expect(normalizeMapSettings(null)).toEqual(DEFAULT_MAP_SETTINGS);
  });
});

describe("prioridades", () => {
  const ids = ["transporte", "parque", "atacarejo"];

  it("só um principal: escolher outro rebaixa o anterior para importante", () => {
    const p = setImportance({}, ids, "parque", 3);
    expect(importanceOf(p, "parque")).toBe(3);
    expect(importanceOf(p, "transporte")).toBe(2);
    expect(mainOf(p, ids)).toBe("parque");
  });

  it("tirar o principal (ex.: transporte → não uso) passa o posto para o próximo", () => {
    const p = setImportance({}, ids, "transporte", 0);
    expect(importanceOf(p, "transporte")).toBe(0);
    expect(mainOf(p, ids)).toBe("parque");
    expect(importanceOf(p, "parque")).toBe(3);
  });
});
