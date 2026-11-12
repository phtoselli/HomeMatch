import type { BBox, LatLng, TransitMode, TransitRoute } from "../shared/types.js";
import { PointIndex, distance } from "./geo.js";
import { bboxQL, elementPoint, overpass, type OsmElement } from "./osm/overpass.js";

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

const ROUTE_RE = "^(bus|trolleybus|minibus|share_taxi|subway|train|light_rail|tram|monorail)$";

export function buildTransitQuery(work: LatLng, p: TransitParams = DEFAULT_TRANSIT): string {
  const { lat, lng } = work;
  const b = p.busWalkAtWorkM;
  const r = p.railWalkAtWorkM;
  return `[out:json][timeout:180];
(
  node(around:${b},${lat},${lng})["highway"="bus_stop"];
  node(around:${b},${lat},${lng})["public_transport"="platform"];
  node(around:${r},${lat},${lng})["public_transport"="stop_position"];
  node(around:${r},${lat},${lng})["railway"~"^(station|halt|stop|tram_stop)$"];
)->.near;
(
  way(around:${r},${lat},${lng})["public_transport"="platform"];
  way(around:${r},${lat},${lng})["railway"="platform"];
)->.nearw;
(
  rel(bn.near)["type"="route"]["route"~"${ROUTE_RE}"];
  rel(bw.nearw)["type"="route"]["route"~"${ROUTE_RE}"];
)->.routes;
.routes out body;
node(r.routes);
out skel qt;
(
  way(r.routes:"platform");
  way(r.routes:"platform_entry_only");
  way(r.routes:"platform_exit_only");
);
out center qt;`;
}

export interface ParsedRoute extends TransitRoute {
  ptv2: boolean;
}

function normalizeMode(route: string): TransitMode {
  if (route === "minibus" || route === "share_taxi") return "bus";
  return (route in MODES ? route : "bus") as TransitMode;
}

/** Monta as linhas a partir da resposta do Overpass: paradas em ordem, sem duplicatas vizinhas. */
export function parseRoutes(elements: OsmElement[]): ParsedRoute[] {
  const nodes = new Map<number, LatLng>();
  const ways = new Map<number, LatLng>();
  for (const e of elements) {
    const p = elementPoint(e);
    if (!p) continue;
    if (e.type === "node") nodes.set(e.id, p);
    else if (e.type === "way") ways.set(e.id, p);
  }
  const out: ParsedRoute[] = [];
  for (const rel of elements) {
    if (rel.type !== "relation" || !rel.members) continue;
    const t = rel.tags ?? {};
    const path: [number, number][] = [];
    for (const m of rel.members) {
      let p: LatLng | undefined;
      if (m.type === "node") p = nodes.get(m.ref);
      else if (m.type === "way" && m.role.startsWith("platform")) p = ways.get(m.ref);
      if (!p) continue;
      const last = path[path.length - 1];
      // parada (stop_position) e plataforma costumam vir em par: junta os pontos muito próximos
      if (last && distance({ lat: last[0], lng: last[1] }, p) < 80) continue;
      path.push([p.lat, p.lng]);
    }
    if (path.length < 2) continue;
    const mode = normalizeMode(t.route ?? "bus");
    out.push({
      id: String(rel.id),
      ref: t.ref,
      name: t.name || [t.ref, t.to].filter(Boolean).join(" → ") || `Linha ${rel.id}`,
      mode,
      color: /^#[0-9a-f]{3,6}$/i.test(t.colour ?? "") ? t.colour! : MODES[mode].color,
      operator: t.operator ?? t.network,
      path,
      ptv2: t["public_transport:version"] === "2",
    });
  }
  return out;
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

/**
 * Para cada parada de cada linha, o menor tempo de "embarcar aqui e chegar ao trabalho",
 * descendo em uma parada posterior que esteja a uma caminhada do trabalho.
 * Linhas PTv1 (sem sentido definido) são avaliadas nos dois sentidos.
 */
export function boardingStops(routes: ParsedRoute[], work: LatLng, p: TransitParams = DEFAULT_TRANSIT): BoardingStop[] {
  const best = new Map<string, BoardingStop>();
  for (const r of routes) {
    const info = MODES[r.mode];
    const walkLimit = info.rail ? p.railWalkAtWorkM : p.busWalkAtWorkM;
    const speedMpm = (info.speedKmh * 1000) / 60;
    const directions = r.ptv2 ? [r.path] : [r.path, [...r.path].reverse()];
    for (const path of directions) {
      const pts = path.map(([lat, lng]) => ({ lat, lng }));
      const n = pts.length;
      const walkWork = pts.map((s) => {
        const d = distance(s, work);
        return d <= walkLimit ? (d * p.walkDetour) / p.walkSpeedMpm : Infinity;
      });
      // tail[i] = melhor (viagem de i até j>i) + caminhada de j ao trabalho
      const tail = new Array<number>(n).fill(Infinity);
      for (let i = n - 2; i >= 0; i--) {
        const ride = (distance(pts[i]!, pts[i + 1]!) * info.detour) / speedMpm;
        tail[i] = ride + Math.min(walkWork[i + 1]!, tail[i + 1]!);
      }
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(tail[i]!)) continue;
        const v = info.waitMin + tail[i]!;
        const s = pts[i]!;
        const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
        const cur = best.get(key);
        if (!cur || v < cur.valueMin) best.set(key, { ...s, valueMin: v, routeId: r.id, label: routeLabel(r) });
      }
    }
  }
  return [...best.values()];
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

export async function fetchBusStops(bbox: BBox): Promise<LatLng[]> {
  const q = `[out:json][timeout:180];(node["highway"="bus_stop"](${bboxQL(bbox)});node["public_transport"="platform"]["bus"="yes"](${bboxQL(bbox)}););out skel qt;`;
  const res = await overpass(q);
  return res.elements.filter((e) => e.lat != null).map((e) => ({ lat: e.lat!, lng: e.lon! }));
}

export async function fetchRoutesNearWork(work: LatLng, p: TransitParams = DEFAULT_TRANSIT): Promise<ParsedRoute[]> {
  const res = await overpass(buildTransitQuery(work, p));
  return parseRoutes(res.elements);
}
