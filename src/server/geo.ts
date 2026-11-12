import type { BBox, LatLng, Polygon, Ring } from "../shared/types.js";

const R = 6_371_000;
const RAD = Math.PI / 180;
export const M_PER_DEG_LAT = 111_320;

/** Distância em metros entre dois pontos (haversine). */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function metersPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos(lat * RAD);
}

export function padBBox(b: BBox, meters: number): BBox {
  const mid = (b.north + b.south) / 2;
  const dLat = meters / M_PER_DEG_LAT;
  const dLng = meters / metersPerDegLng(mid);
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLng, east: b.east + dLng };
}

export function bboxAround(p: LatLng, meters: number): BBox {
  return padBBox({ south: p.lat, north: p.lat, west: p.lng, east: p.lng }, meters);
}

export function inBBox(p: LatLng, b: BBox): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

export function bboxOf(points: LatLng[]): BBox {
  const b = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
  for (const p of points) {
    b.south = Math.min(b.south, p.lat);
    b.north = Math.max(b.north, p.lat);
    b.west = Math.min(b.west, p.lng);
    b.east = Math.max(b.east, p.lng);
  }
  return b;
}

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ponto dentro de um multipolígono (anéis em [lng, lat]). */
export function inMultiPolygon(p: LatLng, polys: Polygon[]): boolean {
  for (const poly of polys) {
    const [outer, ...holes] = poly;
    if (!outer || !inRing(p.lng, p.lat, outer)) continue;
    if (holes.some((h) => inRing(p.lng, p.lat, h))) continue;
    return true;
  }
  return false;
}

/** Centros de uma grade regular (em metros) cobrindo a bbox. */
export function gridCenters(b: BBox, cellM: number): LatLng[] {
  const mid = (b.north + b.south) / 2;
  const dLat = cellM / M_PER_DEG_LAT;
  const dLng = cellM / metersPerDegLng(mid);
  const out: LatLng[] = [];
  for (let lat = b.south + dLat / 2; lat < b.north; lat += dLat) {
    for (let lng = b.west + dLng / 2; lng < b.east; lng += dLng) out.push({ lat, lng });
  }
  return out;
}

/**
 * Índice espacial simples por baldes (grade de ~bucketM metros).
 * Bom o bastante para dezenas de milhares de pontos dentro de uma cidade.
 */
export class PointIndex<T extends LatLng> {
  private buckets = new Map<string, T[]>();
  private dLat: number;
  private dLng: number;

  constructor(
    points: T[],
    private bucketM = 1000,
    refLat = points[0]?.lat ?? 0,
  ) {
    this.dLat = bucketM / M_PER_DEG_LAT;
    this.dLng = bucketM / metersPerDegLng(refLat);
    for (const p of points) {
      const k = this.key(Math.floor(p.lat / this.dLat), Math.floor(p.lng / this.dLng));
      let arr = this.buckets.get(k);
      if (!arr) this.buckets.set(k, (arr = []));
      arr.push(p);
    }
  }

  get size(): number {
    let n = 0;
    for (const a of this.buckets.values()) n += a.length;
    return n;
  }

  private key(i: number, j: number): string {
    return `${i}:${j}`;
  }

  /** Todos os pontos a até `radiusM` metros, com a distância. */
  within(p: LatLng, radiusM: number): { item: T; dist: number }[] {
    const ri = Math.ceil(radiusM / this.bucketM);
    const ci = Math.floor(p.lat / this.dLat);
    const cj = Math.floor(p.lng / this.dLng);
    const out: { item: T; dist: number }[] = [];
    for (let i = ci - ri; i <= ci + ri; i++) {
      for (let j = cj - ri; j <= cj + ri; j++) {
        const arr = this.buckets.get(this.key(i, j));
        if (!arr) continue;
        for (const item of arr) {
          const d = distance(p, item);
          if (d <= radiusM) out.push({ item, dist: d });
        }
      }
    }
    return out;
  }

  /** Ponto mais próximo a até `maxM` metros (ou null). */
  nearest(p: LatLng, maxM: number): { item: T; dist: number } | null {
    let best: { item: T; dist: number } | null = null;
    for (const r of this.within(p, maxM)) if (!best || r.dist < best.dist) best = r;
    return best;
  }
}
