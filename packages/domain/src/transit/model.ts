import type { LatLng, TransitMode, TransitRoute } from "@homematch/contracts";
import { PointIndex, distance } from "../geo.js";

/**
 * Modelo de trajeto (sem GTFS): linhas diretas do OpenStreetMap que param perto do trabalho.
 * tempo = caminhada até a parada + espera média + viagem (distância entre paradas / velocidade) + caminhada até o trabalho.
 * É uma estimativa para comparar regiões, não um horário exato.
 */
export interface TransitParams {
  walkSpeedMpm: number; // metros por minuto
  walkDetour: number; // fator de desvio da caminhada sobre a linha reta
  busWalkAtWorkM: number; // até onde vale descer do ônibus e andar até o trabalho
  railWalkAtWorkM: number; // idem para metrô/trem
}

export const DEFAULT_TRANSIT: TransitParams = {
  walkSpeedMpm: 75,
  walkDetour: 1.25,
  busWalkAtWorkM: 700,
  railWalkAtWorkM: 1300,
};

interface ModeInfo {
  speedKmh: number;
  waitMin: number;
  detour: number;
  rail: boolean;
  color: string;
  label: string;
}

export const MODES: Record<TransitMode, ModeInfo> = {
  bus: { speedKmh: 15, waitMin: 8, detour: 1.15, rail: false, color: "#1c7ed6", label: "Ônibus" },
  trolleybus: { speedKmh: 15, waitMin: 8, detour: 1.15, rail: false, color: "#1098ad", label: "Trólebus" },
  tram: { speedKmh: 18, waitMin: 6, detour: 1.1, rail: true, color: "#f59f00", label: "Bonde/VLT" },
  light_rail: { speedKmh: 25, waitMin: 6, detour: 1.1, rail: true, color: "#f59f00", label: "VLT" },
  monorail: { speedKmh: 30, waitMin: 5, detour: 1.05, rail: true, color: "#ae3ec9", label: "Monotrilho" },
  subway: { speedKmh: 32, waitMin: 3, detour: 1.05, rail: true, color: "#e03131", label: "Metrô" },
  train: { speedKmh: 35, waitMin: 8, detour: 1.05, rail: true, color: "#5f3dc4", label: "Trem" },
};

export interface ParsedRoute extends TransitRoute {
  ptv2: boolean;
  /** Paradas só de desembarque (mesmo índice de `path`): dá para descer, não para embarcar. */
  alightOnly?: boolean[];
}

export function routeLabel(r: Pick<TransitRoute, "ref" | "name" | "mode">): string {
  const kind = MODES[r.mode].label;
  return r.ref ? `${kind} ${r.ref}` : `${kind}: ${r.name}`;
}

/** Ponto de embarque com o menor tempo (espera + viagem + caminhada final) até o trabalho. */
export interface BoardingStop extends LatLng {
  valueMin: number;
  routeId: string;
  label: string;
}

/** Baldeação: até onde andar entre o ponto de descida e o da segunda linha, e a folga extra. */
export const TRANSFER = { maxWalkM: 400, slackMin: 3 };

type Exit = (pt: LatLng, rail: boolean) => { cost: number; via?: string } | null;

/**
 * Programação dinâmica de trás para frente em cada sentido de cada linha:
 * tail[i] = viagem de i até i+1 + min(descer em i+1, seguir viagem). Gera o valor de embarcar em i.
 */
function propagate(routes: ParsedRoute[], exit: Exit, best: Map<string, BoardingStop>) {
  for (const r of routes) {
    const info = MODES[r.mode];
    const speedMpm = (info.speedKmh * 1000) / 60;
    const dirs: { path: [number, number][]; noBoard?: boolean[] }[] = r.ptv2
      ? [{ path: r.path, noBoard: r.alightOnly }]
      : [
          { path: r.path, noBoard: r.alightOnly },
          { path: [...r.path].reverse(), noBoard: r.alightOnly && [...r.alightOnly].reverse() },
        ];
    for (const { path, noBoard } of dirs) {
      const pts = path.map(([lat, lng]) => ({ lat, lng }));
      const n = pts.length;
      const exits = pts.map((pt) => exit(pt, info.rail));
      const tail = new Array<number>(n).fill(Infinity);
      const via = new Array<string | undefined>(n);
      for (let i = n - 2; i >= 0; i--) {
        const ride = (distance(pts[i]!, pts[i + 1]!) * info.detour) / speedMpm;
        const e = exits[i + 1];
        if (e && e.cost <= tail[i + 1]!) {
          tail[i] = ride + e.cost;
          via[i] = e.via;
        } else {
          tail[i] = ride + tail[i + 1]!;
          via[i] = via[i + 1];
        }
      }
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(tail[i]!) || noBoard?.[i]) continue;
        const v = info.waitMin + tail[i]!;
        const s = pts[i]!;
        const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
        const cur = best.get(key);
        const label = via[i] ? `${routeLabel(r)} + ${via[i]}` : routeLabel(r);
        if (!cur || v < cur.valueMin) best.set(key, { ...s, valueMin: v, routeId: r.id, label });
      }
    }
  }
}

/**
 * Para cada parada de cada linha, o menor tempo de "embarcar aqui e chegar ao trabalho",
 * descendo em uma parada posterior que esteja a uma caminhada do trabalho.
 * Com `transfers`, também vale descer perto de outra linha que chegue lá (uma baldeação).
 * Linhas PTv1 (sem sentido definido) são avaliadas nos dois sentidos.
 */
export function boardingStops(
  routes: ParsedRoute[],
  work: LatLng,
  p: TransitParams = DEFAULT_TRANSIT,
  opts: { transfers?: boolean } = {},
): BoardingStop[] {
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  const direct = new Map<string, BoardingStop>();
  propagate(
    routes,
    (pt, rail) => {
      const d = distance(pt, work);
      return d <= (rail ? p.railWalkAtWorkM : p.busWalkAtWorkM) ? { cost: walk(d) } : null;
    },
    direct,
  );
  if (!opts.transfers || !direct.size) return [...direct.values()];

  // Segunda passada: descer perto de um embarque direto e trocar de linha.
  const idx = new PointIndex([...direct.values()], 500, work.lat);
  const all = new Map(direct);
  propagate(
    routes,
    (pt) => {
      let bestT: { cost: number; via?: string } | null = null;
      for (const { item, dist } of idx.within(pt, TRANSFER.maxWalkM)) {
        const cost = walk(dist) + TRANSFER.slackMin + item.valueMin;
        if (!bestT || cost < bestT.cost) bestT = { cost, via: item.label };
      }
      return bestT;
    },
    all,
  );
  return [...all.values()];
}

export interface Commute {
  minutes: number;
  via: string;
  routeId?: string;
}

/** Tempo estimado de um ponto até o trabalho: a pé ou pela melhor linha direta. */
export function commuteFrom(
  from: LatLng,
  work: LatLng,
  stops: PointIndex<BoardingStop>,
  maxWalkToStopM: number,
  p: TransitParams = DEFAULT_TRANSIT,
): Commute {
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  let best: Commute = { minutes: walk(distance(from, work)), via: "a pé" };
  for (const { item, dist } of stops.within(from, maxWalkToStopM)) {
    const t = walk(dist) + item.valueMin;
    if (t < best.minutes) best = { minutes: t, via: item.label, routeId: item.routeId };
  }
  return best;
}

/**
 * Estimativa reserva para cidades com poucas linhas mapeadas no OSM: se há ponto de ônibus perto
 * da casa e perto do trabalho, assume um ônibus (talvez com baldeação) em linha quase reta.
 */
export const GENERIC_BUS = { speedKmh: 15, waitMin: 8, transferSlackMin: 4, detour: 1.35, label: "ônibus (estimado)" };

export function genericBusCommute(
  from: LatLng,
  work: LatLng,
  busStops: PointIndex<LatLng>,
  maxWalkToStopM: number,
  workStopDistM: number,
  p: TransitParams = DEFAULT_TRANSIT,
): Commute | null {
  const near = busStops.nearest(from, maxWalkToStopM);
  if (!near) return null;
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  const ride = (distance(from, work) * GENERIC_BUS.detour) / ((GENERIC_BUS.speedKmh * 1000) / 60);
  return {
    minutes: walk(near.dist) + GENERIC_BUS.waitMin + GENERIC_BUS.transferSlackMin + ride + walk(workStopDistM),
    via: GENERIC_BUS.label,
  };
}
