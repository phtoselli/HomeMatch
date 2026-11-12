import type { BusLine, Cell, LatLng } from "../shared/types";

export function distM(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Parada mais próxima de uma linha (até 3 km). */
export function nearestStop(line: BusLine, p: LatLng): { name?: string; dist: number } | null {
  let best: { name?: string; dist: number } | null = null;
  for (const s of line.stops) {
    const d = distM(p, s);
    if (d <= 3000 && (!best || d < best.dist)) best = { name: s.name, dist: d };
  }
  return best;
}

/** Minutos a pé (75 m/min, 25% de desvio sobre a linha reta). */
export const walkMin = (m: number) => Math.max(1, Math.round((m * 1.25) / 75));

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const money = (n: number) => brl.format(n);

/** "R$ 3,2 mil" — curto, para o marcador no mapa. */
export function moneyShort(n: number): string {
  if (n >= 1000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(n)}`;
}

export function meters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}

/** Cor da nota (0..100): amarelo → verde. */
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100));
  const hue = 45 + t * 95;
  const light = 58 - t * 18;
  return `hsl(${hue.toFixed(0)} 75% ${light.toFixed(0)}%)`;
}

/** Índice simples para achar a célula analisada mais próxima de um ponto. */
export function makeCellLookup(cells: Cell[], cellSizeM: number) {
  const step = 0.01;
  const buckets = new Map<string, Cell[]>();
  const key = (lat: number, lng: number) => `${Math.floor(lat / step)}:${Math.floor(lng / step)}`;
  for (const c of cells) {
    const k = key(c.lat, c.lng);
    let a = buckets.get(k);
    if (!a) buckets.set(k, (a = []));
    a.push(c);
  }
  const maxDeg = (cellSizeM * 0.75) / 111_320;
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
