import type { LatLng, TransitMode, TransitRoute, TravelKind } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { PointIndex, distance } from "../geo.js";

/**
 * Commute model (no GTFS): direct OpenStreetMap / operator lines that stop near work.
 * time = walk to the stop + average wait + ride (distance between stops / speed) + walk to work.
 * It is an estimate to compare regions, not an exact schedule.
 */
export interface TransitParams {
  /** Meters per minute. */
  walkSpeedMpm: number;
  /** Detour factor of walking over the straight line. */
  walkDetour: number;
  /** How far one may get off the bus and walk to work. */
  busWalkAtWorkM: number;
  /** Same, for subway/train. */
  railWalkAtWorkM: number;
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
}

export const MODES: Record<TransitMode, ModeInfo> = {
  bus: { speedKmh: 15, waitMin: 8, detour: 1.15, rail: false, color: "#1c7ed6" },
  trolleybus: { speedKmh: 15, waitMin: 8, detour: 1.15, rail: false, color: "#1098ad" },
  tram: { speedKmh: 18, waitMin: 6, detour: 1.1, rail: true, color: "#f59f00" },
  light_rail: { speedKmh: 25, waitMin: 6, detour: 1.1, rail: true, color: "#f59f00" },
  monorail: { speedKmh: 30, waitMin: 5, detour: 1.05, rail: true, color: "#ae3ec9" },
  subway: { speedKmh: 32, waitMin: 3, detour: 1.05, rail: true, color: "#e03131" },
  train: { speedKmh: 35, waitMin: 8, detour: 1.05, rail: true, color: "#5f3dc4" },
};

export interface ParsedRoute extends TransitRoute {
  ptv2: boolean;
  /** Alight-only stops (same index as `path`): riders can get off there, not on. */
  alightOnly?: boolean[];
}

/** "Bus 353", or "Bus: <name>" for lines without a number (localized). */
export function routeLabel(r: Pick<TransitRoute, "ref" | "name" | "mode">): string {
  return t.transit.routeLabel(t.transit.modes[r.mode], r.ref, r.name);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Mode names ("Ônibus", "Metrô"…) longest first, so "Bonde/VLT" wins over "VLT". */
const MODE_PREFIX = new RegExp(
  `(${Object.values(t.transit.modes)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|")})[: ]\\s*`,
  "g",
);

/** Drops the vehicle type from a route label: "Ônibus 350 + Ônibus 353" → "350 + 353"; "on foot" stays as it is. */
export const shortVia = (via: string) => via.replace(MODE_PREFIX, "").trim();

/** Boarding point with the shortest time (wait + ride + final walk) to work. */
export interface BoardingStop extends LatLng {
  valueMin: number;
  routeId: string;
  label: string;
}

/** Transfer: how far to walk between the stop you get off and the second line's stop, plus extra slack. */
export const TRANSFER = { maxWalkM: 400, slackMin: 3 };

type Exit = (pt: LatLng, rail: boolean) => { cost: number; via?: string } | null;

/**
 * Backwards dynamic programming along each direction of each line:
 * tail[i] = ride from i to i+1 + min(get off at i+1, keep riding). It yields the value of boarding at i.
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
        const label = via[i] ? t.transit.withTransfer(routeLabel(r), via[i]!) : routeLabel(r);
        if (!cur || v < cur.valueMin) best.set(key, { ...s, valueMin: v, routeId: r.id, label });
      }
    }
  }
}

/**
 * For each stop of each line, the shortest "board here and reach work" time, getting off at a later stop within
 * walking distance of work. With `transfers`, getting off near another line that reaches work also counts (one
 * transfer). PTv1 lines (no defined direction) are evaluated both ways.
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

  // Second pass: get off near a direct boarding stop and change lines.
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
  travel: TravelKind;
  /** Display label: "on foot" or the line(s). */
  via: string;
  routeId?: string;
}

/** Estimated time from a point to work: on foot or by the best boarding stop within walking distance. */
export function commuteFrom(
  from: LatLng,
  work: LatLng,
  stops: PointIndex<BoardingStop>,
  maxWalkToStopM: number,
  p: TransitParams = DEFAULT_TRANSIT,
): Commute {
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  let best: Commute = { minutes: walk(distance(from, work)), travel: "walk", via: t.transit.onFoot };
  for (const { item, dist } of stops.within(from, maxWalkToStopM)) {
    const minutes = walk(dist) + item.valueMin;
    if (minutes < best.minutes) best = { minutes, travel: "transit", via: item.label, routeId: item.routeId };
  }
  return best;
}

/**
 * Fallback estimate for cities with few lines mapped in OSM: if there is a bus stop near home and near work,
 * assume a bus (maybe with a transfer) along an almost straight line.
 */
export const GENERIC_BUS = {
  speedKmh: 15,
  waitMin: 8,
  transferSlackMin: 4,
  detour: 1.35,
  /** Between cities: only the in-town part (summed, straight line) runs at 15 km/h; the rest is highway. */
  urbanM: 6000,
  roadSpeedKmh: 40,
};

/** Estimated bus ride over `d` straight-line meters; between cities, anything beyond `urbanM` is highway. */
export function busRideMin(d: number, intercity: boolean): number {
  const mpm = (kmh: number) => (kmh * 1000) / 60;
  const urban = intercity ? Math.min(d, GENERIC_BUS.urbanM) : d;
  return GENERIC_BUS.detour * (urban / mpm(GENERIC_BUS.speedKmh) + (d - urban) / mpm(GENERIC_BUS.roadSpeedKmh));
}

export function genericBusCommute(
  from: LatLng,
  work: LatLng,
  busStops: PointIndex<LatLng>,
  maxWalkToStopM: number,
  workStopDistM: number,
  p: TransitParams = DEFAULT_TRANSIT,
  intercity = false,
): Commute | null {
  const near = busStops.nearest(from, maxWalkToStopM);
  if (!near) return null;
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  const ride = busRideMin(distance(from, work), intercity);
  return {
    minutes: walk(near.dist) + GENERIC_BUS.waitMin + GENERIC_BUS.transferSlackMin + ride + walk(workStopDistM),
    travel: "estimated",
    via: intercity ? t.transit.estimatedIntercityBus : t.transit.estimatedBus,
  };
}
