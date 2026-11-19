import { describe, expect, it } from "vitest";
import {
  M_PER_DEG_LAT,
  gridCenters,
  levelAreas,
  ringArea,
  smoothRing,
  traceCells,
  type AreaCell,
} from "../src/index.js";

const set = (...cells: [number, number][]) => new Set(cells.map(([r, c]) => `${r},${c}`));

describe("traceCells", () => {
  it("one outline around a block of cells, counter-clockwise", () => {
    const rings = traceCells(set([0, 0], [0, 1], [1, 0], [1, 1]));
    expect(rings).toHaveLength(1);
    expect(ringArea(rings[0]!)).toBe(4);
  });

  it("cells touching only at a corner stay apart", () => {
    const rings = traceCells(set([0, 0], [1, 1]));
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => ringArea(r) === 1)).toBe(true);
  });

  it("a ring of cells has an outer ring and a clockwise hole", () => {
    const cells: [number, number][] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (r !== 1 || c !== 1) cells.push([r, c]);
    const areas = traceCells(set(...cells))
      .map(ringArea)
      .sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]);
  });
});

describe("smoothRing", () => {
  it("rounds corners and keeps the shape about the same size", () => {
    const square: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const s = smoothRing(square);
    expect(s.length).toBeGreaterThan(4);
    const area = ringArea(s);
    expect(area).toBeGreaterThan(15);
    expect(area).toBeLessThan(16);
  });
});

describe("levelAreas", () => {
  const bbox = { south: -22.95, west: -47.1, north: -22.9, east: -47.03 };
  const centers = gridCenters(bbox, 250);
  const lat0 = centers[0]!.lat;
  const lng0 = centers[0]!.lng;
  // Two blobs: excellent inside good, and a separate ok spot.
  const cells = centers.flatMap((c): AreaCell[] => {
    const r = Math.round(((c.lat - lat0) * M_PER_DEG_LAT) / 250);
    const col = Math.round((c.lng - lng0) / (centers[1]!.lng - lng0));
    const lat = Math.round(c.lat * 1e5) / 1e5;
    const lng = Math.round(c.lng * 1e5) / 1e5;
    if (r >= 4 && r <= 6 && col >= 4 && col <= 6) return [{ lat, lng, level: "excellent" }];
    if (r >= 2 && r <= 8 && col >= 2 && col <= 8) return [{ lat, lng, level: "good" }];
    if (r === 15 && col >= 15 && col <= 20) return [{ lat, lng, level: "ok" }];
    return [];
  });

  it("nests the levels: each area includes the better ones", () => {
    const areas = levelAreas(cells, 250, "ok");
    expect(areas.map((a) => a.level)).toEqual(["ok", "good", "excellent"]);
    const [ok, good, excellent] = areas;
    expect(ok!.polygons).toHaveLength(2);
    expect(good!.polygons).toHaveLength(1);
    expect(excellent!.polygons).toHaveLength(1);
    // The good shape has no hole where the excellent cells are.
    expect(good!.polygons[0]).toHaveLength(1);
  });

  it("stays on the cells (outline within half a cell of the block)", () => {
    const [excellent] = levelAreas(cells, 250, "excellent");
    const lats = excellent!.polygons[0]![0]!.map((p) => p.lat);
    const exc = cells.filter((c) => c.level === "excellent");
    const top = Math.max(...exc.map((c) => c.lat)) + 125 / M_PER_DEG_LAT;
    expect(Math.max(...lats)).toBeLessThanOrEqual(top + 1e-6);
    expect(Math.max(...lats)).toBeGreaterThan(top - 125 / M_PER_DEG_LAT);
  });

  it("respects the minimum level", () => {
    expect(levelAreas(cells, 250, "good").map((a) => a.level)).toEqual(["good", "excellent"]);
  });
});
