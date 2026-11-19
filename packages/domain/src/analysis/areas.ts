import type { LatLng, RegionLevel } from "@homematch/contracts";
import { REGION_LEVELS } from "@homematch/contracts/constants";
import { M_PER_DEG_LAT, metersPerDegLng } from "../geo.js";
import { levelRank } from "./levels.js";

/**
 * Level areas for the map: instead of thousands of squares, one smooth outline per level. Each level's area
 * includes the better ones (the "good" area also covers the "excellent" one), so drawn from "ok" up they nest like
 * contour lines.
 */
export interface AreaCell {
  lat: number;
  lng: number;
  level: RegionLevel;
}

/** One shape: the outer ring, then its holes. */
export type AreaPolygon = LatLng[][];

export interface LevelArea {
  level: RegionLevel;
  polygons: AreaPolygon[];
}

export interface AreaOptions {
  /** Smoothing passes after the corners are rounded (each doubles the points). */
  smooth?: number;
  /** Holes smaller than this many cells are filled (a single missing block is noise, not a gap). */
  minHoleCells?: number;
}

interface Grid {
  lat0: number;
  lng0: number;
  dLat: number;
  dLng: number;
}

/**
 * Grid of the analysis, read back from the cell centers: the latitude step is exact, the longitude one is fitted
 * (least squares) because it depends on the latitude the server used.
 */
export function gridOf(cells: LatLng[], cellSizeM: number): Grid {
  const dLat = cellSizeM / M_PER_DEG_LAT;
  let lat0 = Infinity;
  let lng0 = Infinity;
  let latSum = 0;
  for (const c of cells) {
    lat0 = Math.min(lat0, c.lat);
    lng0 = Math.min(lng0, c.lng);
    latSum += c.lat;
  }
  let dLng = cellSizeM / metersPerDegLng(latSum / Math.max(1, cells.length));
  for (let pass = 0; pass < 2; pass++) {
    let num = 0;
    let den = 0;
    for (const c of cells) {
      const col = Math.round((c.lng - lng0) / dLng);
      num += (c.lng - lng0) * col;
      den += col * col;
    }
    if (den) dLng = num / den;
  }
  return { lat0, lng0, dLat, dLng };
}

type Pt = [number, number];
interface Edge {
  a: Pt;
  b: Pt;
  used: boolean;
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * Outlines of a set of grid cells (row, col): outer rings counter-clockwise, holes clockwise, in vertex units
 * (cell (r, c) spans x c..c+1, y r..r+1). Cells touching only at a corner stay separate shapes.
 */
export function traceCells(cells: Set<string>): Pt[][] {
  const has = (r: number, c: number) => cells.has(key(r, c));
  const from = new Map<string, Edge[]>();
  const add = (a: Pt, b: Pt) => {
    const k = key(a[0], a[1]);
    let list = from.get(k);
    if (!list) from.set(k, (list = []));
    list.push({ a, b, used: false });
  };
  for (const k of cells) {
    const [r, c] = k.split(",").map(Number) as [number, number];
    if (!has(r - 1, c)) add([c, r], [c + 1, r]);
    if (!has(r, c + 1)) add([c + 1, r], [c + 1, r + 1]);
    if (!has(r + 1, c)) add([c + 1, r + 1], [c, r + 1]);
    if (!has(r, c - 1)) add([c, r + 1], [c, r]);
  }
  // Turn preference at a vertex: left, straight, right (left keeps corner-touching cells apart).
  const turn = (e: Edge, n: Edge) => {
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const nx = n.b[0] - n.a[0];
    const ny = n.b[1] - n.a[1];
    const cross = dx * ny - dy * nx;
    return cross > 0 ? 0 : cross === 0 ? 1 : 2;
  };
  const rings: Pt[][] = [];
  for (const list of from.values()) {
    for (const first of list) {
      if (first.used) continue;
      first.used = true;
      const ring: Pt[] = [first.a];
      let cur = first;
      for (;;) {
        const end = cur.b;
        const options = (from.get(key(end[0], end[1])) ?? []).filter((e) => !e.used || e === first);
        if (!options.length) break;
        options.sort((x, y) => turn(cur, x) - turn(cur, y));
        const next = options[0]!;
        if (next === first) break;
        next.used = true;
        ring.push(next.a);
        cur = next;
      }
      rings.push(ring);
    }
  }
  return rings;
}

/** Twice the signed area (positive = counter-clockwise = outer ring). */
export function ringArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Drops the vertices in the middle of straight runs: only corners remain. */
function corners(ring: Pt[]): Pt[] {
  const n = ring.length;
  return ring.filter((p, i) => {
    const a = ring[(i - 1 + n) % n]!;
    const b = ring[(i + 1) % n]!;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

/**
 * Rounds the corners: each corner is cut half a cell along both sides (less on short sides), so one-cell stairs turn
 * into diagonals, then Chaikin passes smooth what is left. Long straight sides keep their length.
 */
export function smoothRing(ring: Pt[], passes = 2): Pt[] {
  const pts = corners(ring);
  const n = pts.length;
  if (n < 3) return ring;
  let out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i]!;
    const p = pts[(i - 1 + n) % n]!;
    const q = pts[(i + 1) % n]!;
    const lp = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const lq = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const r = Math.min(0.5, lp / 2, lq / 2);
    out.push([v[0] + ((p[0] - v[0]) * r) / lp, v[1] + ((p[1] - v[1]) * r) / lp]);
    out.push([v[0] + ((q[0] - v[0]) * r) / lq, v[1] + ((q[1] - v[1]) * r) / lq]);
  }
  for (let k = 0; k < passes; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out = next;
  }
  return out;
}

/** Outlines of the cells at each level from `minLevel` up (each including the better levels), in lat/lng. */
export function levelAreas(
  cells: AreaCell[],
  cellSizeM: number,
  minLevel: RegionLevel,
  opts: AreaOptions = {},
): LevelArea[] {
  if (!cells.length) return [];
  const { smooth = 2, minHoleCells = 3 } = opts;
  const g = gridOf(cells, cellSizeM);
  const indexed = cells.map((c) => ({
    k: key(Math.round((c.lat - g.lat0) / g.dLat), Math.round((c.lng - g.lng0) / g.dLng)),
    rank: levelRank(c.level),
  }));
  const toLatLng = ([x, y]: Pt): LatLng => ({ lat: g.lat0 + (y - 0.5) * g.dLat, lng: g.lng0 + (x - 0.5) * g.dLng });

  const out: LevelArea[] = [];
  for (const level of REGION_LEVELS) {
    if (levelRank(level) < levelRank(minLevel)) continue;
    const set = new Set(indexed.filter((c) => c.rank >= levelRank(level)).map((c) => c.k));
    if (!set.size) continue;
    const rings = traceCells(set);
    const outers = rings
      .filter((r) => ringArea(r) > 0)
      .map((r) => ({ ring: r, area: ringArea(r), holes: [] as Pt[][] }));
    for (const hole of rings) {
      const area = ringArea(hole);
      if (area >= 0 || -area < minHoleCells) continue;
      // The smallest outer ring around the hole owns it. Tested from the center of the empty cell right of the
      // first edge (never on a grid line, where the ray test is ambiguous).
      const [[ax, ay], [bx, by]] = [hole[0]!, hole[1]!];
      const probe: Pt = [(ax + bx) / 2 + (by - ay) / 2, (ay + by) / 2 - (bx - ax) / 2];
      const owner = outers.filter((o) => o.area > -area && inRing(probe, o.ring)).sort((a, b) => a.area - b.area)[0];
      owner?.holes.push(hole);
    }
    out.push({
      level,
      polygons: outers.map((o) => [o.ring, ...o.holes].map((r) => smoothRing(r, smooth).map(toLatLng))),
    });
  }
  return out;
}
