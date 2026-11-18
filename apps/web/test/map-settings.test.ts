import { describe, expect, it } from "vitest";
import { atLeast, levelOf, levelRank } from "@homematch/domain";
import { DEFAULT_MAP_SETTINGS, normalizeMapSettings } from "@/features/map/model/settings";
import { importanceOf, mainOf, setImportance } from "@/features/search/model/search";

describe("region levels", () => {
  const c = (id: string, weight: number, hit: boolean) => ({ id, weight, hit, fit: hit ? 1 : 0 });

  it("excellent = main + most of the weight; good = main; ok = something else; none = nothing", () => {
    expect(levelOf([c("transit", 3, true), c("park", 2, true), c("supermarket", 1, false)])).toBe("excellent");
    expect(levelOf([c("transit", 3, true), c("park", 2, false), c("supermarket", 2, false)])).toBe("good");
    expect(levelOf([c("transit", 3, false), c("park", 2, true)])).toBe("ok");
    expect(levelOf([c("transit", 3, false), c("park", 2, false)])).toBeNull();
    expect(levelOf([c("park", 3, true)])).toBe("excellent"); // a single criterion
  });

  it("minimum level filter", () => {
    expect(atLeast("excellent", "good")).toBe(true);
    expect(atLeast("ok", "good")).toBe(false);
    expect(atLeast("ok", "ok")).toBe(true);
    expect(levelRank("excellent")).toBeGreaterThan(levelRank("good"));
  });

  it("old settings (only 4 layers, with a score band) get the rest of the defaults", () => {
    const old = { routes: false, pois: true, cells: true, listings: true, cellBand: "great" } as never;
    const s = normalizeMapSettings(old);
    expect(s.routes).toBe(false);
    expect("cellBand" in s).toBe(false);
    expect(s.hiddenPois).toEqual([]);
    expect(normalizeMapSettings(null)).toEqual(DEFAULT_MAP_SETTINGS);
  });
});

describe("priorities", () => {
  const ids = ["transit", "park", "wholesale_market"];

  it("only one main priority: choosing another demotes the previous one to important", () => {
    const p = setImportance({}, ids, "park", 3);
    expect(importanceOf(p, "park")).toBe(3);
    expect(importanceOf(p, "transit")).toBe(2);
    expect(mainOf(p, ids)).toBe("park");
  });

  it("removing the main one (e.g. transit → not used) hands the role to the next", () => {
    const p = setImportance({}, ids, "transit", 0);
    expect(importanceOf(p, "transit")).toBe(0);
    expect(mainOf(p, ids)).toBe("park");
    expect(importanceOf(p, "park")).toBe(3);
  });
});
