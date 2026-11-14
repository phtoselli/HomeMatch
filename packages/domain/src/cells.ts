import type { Cell, LatLng } from "@homematch/contracts";

/** Índice simples para achar a célula analisada mais próxima de um ponto. */
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

/** Quais notas de região pintar no mapa. */
export type CellBand = "great" | "ok" | "both";

/**
 * A partir de que nota a área é "ótima": o terço de cima entre as áreas que atendem a tudo
 * (as que só chegam perto, na busca flexível, ficam como "ok").
 */
export function greatThreshold(cells: Cell[]): number {
  const scores = cells
    .filter((c) => !c.misses)
    .map((c) => c.score)
    .sort((a, b) => a - b);
  if (!scores.length) return Infinity;
  return scores[Math.floor(scores.length * (2 / 3))] ?? scores[scores.length - 1]!;
}

export const bandOf = (c: Cell, threshold: number): Exclude<CellBand, "both"> =>
  !c.misses && c.score >= threshold ? "great" : "ok";

export const showCell = (c: Cell, band: CellBand, threshold: number) =>
  band === "both" || bandOf(c, threshold) === band;
