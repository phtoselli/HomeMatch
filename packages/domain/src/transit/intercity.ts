import type { LatLng } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { PointIndex, distance } from "../geo.js";
import {
  DEFAULT_TRANSIT,
  GENERIC_BUS,
  TRANSFER,
  busRideMin,
  type BoardingStop,
  type Commute,
  type TransitParams,
} from "./model.js";

/**
 * Work in another city with no mapped intercity line: the intercity bus is estimated up to a terminal in the work
 * city (where such buses usually arrive), and from there the real municipal network (official operator or
 * OpenStreetMap) takes over. More realistic than assuming a bus that drops you at the office door.
 */

/** A terminal in the work city, with the best way to continue from it to work. */
export interface Hub extends LatLng {
  id: string;
  name: string;
  /** Minutes from the terminal to work (on foot or by the best municipal line). */
  toWorkMin: number;
  /** Municipal line used (drawn on the map) and its label; without one, the rest is on foot. */
  routeId?: string;
  label?: string;
}

/** A terminal farther than this from work (on foot or by bus) does not help. */
export const HUB_MAX_TO_WORK_MIN = 60;

/**
 * For each terminal, the best way to reach work: on foot or by walking to a boarding stop (up to 400 m away) of a
 * line that gets there. `arrival` holds the boarding stops of the work city's network (`boardingStops`).
 */
export function hubsToWork(
  stations: (LatLng & { name: string })[],
  arrival: BoardingStop[],
  work: LatLng,
  p: TransitParams = DEFAULT_TRANSIT,
): Hub[] {
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  const idx = new PointIndex(arrival, 500, work.lat);
  const hubs: Hub[] = [];
  stations.forEach((s, i) => {
    let best: Omit<Hub, keyof LatLng | "id" | "name"> = { toWorkMin: walk(distance(s, work)) };
    for (const { item, dist } of idx.within(s, TRANSFER.maxWalkM)) {
      const minutes = walk(dist) + item.valueMin;
      if (minutes < best.toWorkMin) best = { toWorkMin: minutes, routeId: item.routeId, label: item.label };
    }
    if (best.toWorkMin <= HUB_MAX_TO_WORK_MIN)
      hubs.push({ lat: s.lat, lng: s.lng, id: `hub-${i}`, name: s.name, ...best });
  });
  return hubs;
}

export interface HubCommute extends Commute {
  hubId: string;
}

/**
 * Home → bus stop → estimated intercity bus to the terminal → municipal line (or on foot) to work.
 * Picks the terminal with the shortest total time. null without a bus stop near home or without terminals.
 */
export function hubCommute(
  from: LatLng,
  busStops: PointIndex<LatLng>,
  hubs: Hub[],
  maxWalkToStopM: number,
  p: TransitParams = DEFAULT_TRANSIT,
): HubCommute | null {
  if (!hubs.length) return null;
  const near = busStops.nearest(from, maxWalkToStopM);
  if (!near) return null;
  const walk = (m: number) => (m * p.walkDetour) / p.walkSpeedMpm;
  let best: HubCommute | null = null;
  for (const h of hubs) {
    const transfer = h.routeId ? GENERIC_BUS.transferSlackMin : 0;
    const minutes =
      walk(near.dist) + GENERIC_BUS.waitMin + busRideMin(distance(near.item, h), true) + transfer + h.toWorkMin;
    if (!best || minutes < best.minutes) {
      best = {
        minutes,
        travel: "estimated",
        via: t.transit.viaTerminal(h.name, h.label),
        routeId: h.routeId,
        hubId: h.id,
      };
    }
  }
  return best;
}
