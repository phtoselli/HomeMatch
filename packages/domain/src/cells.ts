import type { Cell, LatLng } from "@homematch/contracts";

/** Simple index to find the analyzed cell closest to a point. */
export function makeCellLookup(cells: Cell[], cellSizeM: number, maxM = cellSizeM * 0.75) {
  const step = 0.01;
  const buckets = new Map<string, Cell[]>();
  const key = (lat: number, lng: number) => `${Math.floor(lat / step)}:${Math.floor(lng / step)}`;
  for (const c of cells) {
    const k = key(c.lat, c.lng);
    let a = buckets.get(k);
    if (!a) buckets.set(k, (a = []));
    a.push(c);
  }
  const maxDeg = maxM / 111_320;
  return (p: LatLng): Cell | undefined => {
    let best: Cell | undefined;
    let bestD = Infinity;
    const bi = Math.floor(p.lat / step);
    const bj = Math.floor(p.lng / step);
    for (let i = bi - 1; i <= bi + 1; i++) {
      for (let j = bj - 1; j <= bj + 1; j++) {
        for (const c of buckets.get(`${i}:${j}`) ?? []) {
          const d = Math.hypot(c.lat - p.lat, (c.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180));
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    return bestD <= maxDeg ? best : undefined;
  };
}
