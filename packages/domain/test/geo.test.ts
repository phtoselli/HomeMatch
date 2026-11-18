import { describe, expect, it } from "vitest";
import { PointIndex, distance, gridCenters, inMultiPolygon, padBBox } from "../src/geo.js";

describe("geo", () => {
  it("distance ~ 1 km per 0.009 degree of latitude", () => {
    const d = distance({ lat: -23.55, lng: -46.63 }, { lat: -23.559, lng: -46.63 });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it("gridCenters covers the bbox with the requested cell size", () => {
    const b = padBBox({ south: -23.55, north: -23.55, west: -46.63, east: -46.63 }, 1000); // 2x2 km
    const pts = gridCenters(b, 500);
    expect(pts.length).toBe(16);
  });

  it("PointIndex.nearest finds the closest point within the radius", () => {
    const pts = [
      { lat: -23.55, lng: -46.63, id: "a" },
      { lat: -23.56, lng: -46.63, id: "b" },
      { lat: -23.6, lng: -46.7, id: "c" },
    ];
    const idx = new PointIndex(pts, 500);
    expect(idx.nearest({ lat: -23.5585, lng: -46.63 }, 1000)?.item.id).toBe("b");
    expect(idx.nearest({ lat: -23.7, lng: -46.9 }, 1000)).toBeNull();
    expect(idx.within({ lat: -23.555, lng: -46.63 }, 700).length).toBe(2);
  });

  it("inMultiPolygon respects holes", () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const hole: [number, number][] = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ];
    expect(inMultiPolygon({ lat: 2, lng: 2 }, [[outer, hole]])).toBe(true);
    expect(inMultiPolygon({ lat: 5, lng: 5 }, [[outer, hole]])).toBe(false);
    expect(inMultiPolygon({ lat: 20, lng: 5 }, [[outer, hole]])).toBe(false);
  });
});
