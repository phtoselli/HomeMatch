import type { LatLng } from "@homematch/contracts";
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
 * Trabalho em outra cidade sem linha intermunicipal mapeada: o ônibus intermunicipal é estimado até um terminal da
 * cidade do trabalho (onde ele costuma chegar) e dali vale o transporte municipal de verdade (operador oficial ou
 * OpenStreetMap) até o trabalho. Mais realista do que supor um ônibus que deixa na porta do trabalho.
 */

/** Terminal da cidade do trabalho com o melhor jeito de seguir dali até o trabalho. */
export interface Hub extends LatLng {
  id: string;
  name: string;
  /** Minutos do terminal até o trabalho (a pé ou pela melhor linha municipal). */
  toWorkMin: number;
  /** Linha municipal usada (para desenhar no mapa) e o rótulo dela; sem linha, segue a pé. */
  routeId?: string;
  label?: string;
}

/** Terminal que fica mais longe do trabalho do que isso (a pé ou de ônibus) não ajuda. */
export const HUB_MAX_TO_WORK_MIN = 60;

/**
 * Para cada terminal, o melhor jeito de chegar ao trabalho: a pé ou andando até um embarque (a até 400 m) de uma
 * linha que chega lá. `arrival` são os embarques da rede da cidade do trabalho (`boardingStops`).
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
      const t = walk(dist) + item.valueMin;
      if (t < best.toWorkMin) best = { toWorkMin: t, routeId: item.routeId, label: item.label };
    }
    if (best.toWorkMin <= HUB_MAX_TO_WORK_MIN)
      hubs.push({ lat: s.lat, lng: s.lng, id: `hub-${i}`, name: s.name, ...best });
  });
  return hubs;
}

export interface HubCommute extends Commute {
  hubId: string;
}

export const HUB_LABEL = "intermunicipal (estimado)";

/**
 * Casa → ponto de ônibus → intermunicipal estimado até o terminal → linha municipal (ou a pé) até o trabalho.
 * Escolhe o terminal que dá o menor tempo total. null sem ponto de ônibus perto de casa ou sem terminal.
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
        via: `${HUB_LABEL} até ${h.name}${h.label ? ` + ${h.label}` : ""}`,
        routeId: h.routeId,
        hubId: h.id,
      };
    }
  }
  return best;
}
