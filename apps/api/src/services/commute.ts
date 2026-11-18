import type { AnalyzeRequest, BBox, City, Emit, LatLng, TransitRoute } from "@homematch/contracts";
import {
  DEFAULT_TRANSIT,
  PointIndex,
  bboxAround,
  boardingStops,
  hubsToWork,
  inBBox,
  inMultiPolygon,
  padBBox,
  type BoardingStop,
  type GridInput,
  type Hub,
  type ParsedRoute,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { cityAt, fetchBusStops, fetchIntercity, fetchRoutesNearWork, operatorFor } from "@homematch/sources";

/** Below this, the city's lines are considered poorly mapped in OSM. */
const FEW_ROUTES = 8;
/** With fewer mapped intercity lines leaving the city than this, the terminal-based estimate is added too. */
const FEW_INTERCITY = 3;

const msg = t.commute;

/**
 * Area requested from OpenStreetMap: the whole city with a rounded margin (5 km), not a cut around work. The same
 * query then serves any work location and commute, so the cache almost always hits.
 */
export const osmArea = (city: BBox, marginM: number) => padBBox(city, Math.ceil(Math.max(marginM, 1) / 5000) * 5000);

/** How work is reached: lines, boarding stops with their time to work, and estimates for what is not mapped. */
export interface CommuteNetwork {
  routes: ParsedRoute[];
  stops: BoardingStop[];
  /** Lines stopping near work (always sent to the map, first in the list). */
  nearWorkIds: Set<string>;
  /** Intercity lines leaving the home city (always sent to the map, after the near-work ones). */
  intercityIds: Set<string>;
  fallback?: GridInput["fallback"];
  hubs?: Hub[];
  /** Estimated legs (city → terminal) for the terminals the grid used, to draw on the map. */
  legs(hubsUsed: string[]): TransitRoute[];
}

type Warn = (m: string) => void;

const noLegs = () => [];
const count = (routes: ParsedRoute[], ids: Set<string>) =>
  new Set(routes.filter((r) => ids.has(r.id)).map((r) => r.ref ?? r.id)).size;

/** Lines stopping near work, fastest first, and their numbers for the progress message. */
function nearWork(routes: ParsedRoute[], work: LatLng) {
  const direct = boardingStops(routes, work, DEFAULT_TRANSIT);
  const ids = new Set(direct.map((s) => s.routeId));
  const byId = new Map(routes.map((r) => [r.id, r]));
  const best = new Map<string, number>();
  for (const s of direct) {
    const key = byId.get(s.routeId)?.ref ?? s.routeId;
    best.set(key, Math.min(best.get(key) ?? Infinity, s.valueMin));
  }
  const refs = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  return { direct, ids, count: refs.length, refs };
}

/** The city's official operator network (empty when there is none or it fails). */
async function officialRoutes(city: City, emit: Emit, warn: Warn): Promise<{ routes: ParsedRoute[]; name?: string }> {
  const op = operatorFor(city);
  if (!op) return { routes: [] };
  emit({ type: "progress", message: msg.loadingOperator(op.info.name) });
  const routes = await op.routes().catch((e) => {
    warn(msg.operatorFailed(op.info.name, (e as Error).message));
    return [];
  });
  return { routes, name: op.info.name };
}

/** Work in the same city (or unknown work city): the city's network and, when lacking, an estimated bus. */
export async function localNetwork(
  req: AnalyzeRequest,
  emit: Emit,
  warn: Warn,
  workInCity = true,
): Promise<CommuteNetwork> {
  const op = await officialRoutes(req.city, emit, warn);
  let routes = op.routes;
  // Work in another city: municipal lines do not get there; use whatever OSM has (intercity lines).
  if (routes.length && !boardingStops(routes, req.work, DEFAULT_TRANSIT).length) routes = [];
  const official = routes.length > 0;
  // With the official network at hand, do not wait for Overpass (slow and often at capacity).
  if (!official) {
    emit({ type: "progress", message: msg.searchingNearWork });
    routes = await fetchRoutesNearWork(req.work, DEFAULT_TRANSIT).catch(() => {
      warn(msg.nearWorkUnavailable);
      return [];
    });
  }
  // With the operator's whole network one transfer can be considered; OSM only has the lines near work.
  const transfers = official;
  const near = nearWork(routes, req.work);
  const stops = transfers ? boardingStops(routes, req.work, DEFAULT_TRANSIT, { transfers: true }) : near.direct;
  const viaCount = count(routes, new Set(stops.map((s) => s.routeId)));
  emit({
    type: "progress",
    message: msg.localSummary({
      nearCount: near.count,
      refs: near.refs,
      source: official ? op.name : undefined,
      withTransfer: transfers ? viaCount : undefined,
      stops: stops.length,
    }),
  });
  let fallback: GridInput["fallback"];
  if (near.count < FEW_ROUTES && !(official && near.count > 0)) {
    emit({ type: "progress", message: msg.fewLinesSearchingStops });
    // The city's stops and, when work is in another city, the ones near it.
    const [cityStops, workStops] = await Promise.all([
      fetchBusStops(osmArea(req.city.bbox, 1000)).catch(() => []),
      workInCity ? [] : fetchBusStops(bboxAround(req.work, 1500)).catch(() => []),
    ]);
    const busStops = [...cityStops, ...workStops];
    const workStop = new PointIndex(busStops, 500, req.work.lat).nearest(req.work, DEFAULT_TRANSIT.busWalkAtWorkM);
    if (workStop) {
      fallback = { busStops, workStopDistM: workStop.dist, intercity: !workInCity };
      warn(workInCity ? msg.estimatedBusLocal(near.count) : msg.estimatedBusIntercity(near.count));
    } else if (!near.count) {
      warn(msg.walkOnly);
    }
  }
  return { routes, stops, nearWorkIds: near.ids, intercityIds: new Set(), fallback, legs: noLegs };
}

const ESTIMATED_COLOR = "#495057";

/**
 * Work in another city. Lines near work come first (the work city's network: official operator or OSM), then the
 * intercity lines between both cities (OpenStreetMap), with a transfer at the destination. When intercity lines are
 * missing, the intercity bus is estimated up to a terminal in the work city and the municipal network takes over.
 */
export async function intercityNetwork(req: AnalyzeRequest, emit: Emit, warn: Warn): Promise<CommuteNetwork> {
  const home = req.city;
  const workCity = await cityAt(req.work).catch(() => null);
  if (!workCity || workCity.osmId === home.osmId) return localNetwork(req, emit, warn, !!workCity);

  const homeOp = operatorFor(home);
  const workOp = operatorFor(workCity);
  // The three lookups start together (Overpass is the slowest), but the screen gets the work lines first.
  const interP = fetchIntercity(home, workCity).catch((e: Error) => e);
  const homeP: Promise<ParsedRoute[]> =
    homeOp && homeOp !== workOp
      ? // The home city's network, when it is another operator's and reaches work (adjacent cities).
        officialRoutes(home, emit, warn).then((r) =>
          boardingStops(r.routes, req.work, DEFAULT_TRANSIT).length ? r.routes : [],
        )
      : Promise.resolve([]);
  emit({ type: "progress", message: msg.workElsewhere(workCity.name) });
  // 1) The work city's network: official when an operator is registered; otherwise OSM lines near work.
  const arrival = workOp
    ? (await officialRoutes(workCity, emit, warn)).routes
    : await fetchRoutesNearWork(req.work, DEFAULT_TRANSIT).catch(() => []);
  const near = nearWork(arrival, req.work);
  emit({
    type: "progress",
    message: msg.nearWorkThenIntercity(near.count, workCity.name, workOp?.info.name, near.refs, home.name),
  });
  // 2) Intercity lines between both cities.
  const [inter, homeRoutes] = await Promise.all([interP, homeP]);

  // Overpass down: fall back to the previous computation (lines near work and a direct estimated bus).
  if (inter instanceof Error) {
    warn(msg.intercityUnavailable(inter.message));
    return localNetwork(req, emit, warn, false);
  }

  // The same line may come from OSM both as intercity and as near work: keep it once.
  const routes = [...new Map([...arrival, ...homeRoutes, ...inter.routes].map((r) => [r.id, r])).values()];
  const stops = boardingStops(routes, req.work, DEFAULT_TRANSIT, { transfers: true });
  const atHome = (p: LatLng) => (home.boundary?.length ? inMultiPolygon(p, home.boundary) : inBBox(p, home.bbox));
  const homeIds = new Set(stops.filter(atHome).map((s) => s.routeId));
  const interIds = new Set(inter.routes.map((r) => r.id));
  const interHomeIds = new Set([...homeIds].filter((id) => interIds.has(id)));
  const interUsed = count(inter.routes, interHomeIds);
  emit({
    type: "progress",
    message: msg.intercitySummary({
      lines: count(inter.routes, interIds),
      home: home.name,
      work: workCity.name,
      operator: workOp?.info.name,
      stops: stops.filter(atHome).length,
    }),
  });

  let fallback: GridInput["fallback"];
  let hubs: Hub[] = [];
  if (interUsed < FEW_INTERCITY) {
    hubs = hubsToWork(inter.stations, stops, req.work);
    const busStops = inter.homeStops;
    if (hubs.length && busStops.length) {
      fallback = { busStops, workStopDistM: 0, intercity: true };
      warn(msg.estimatedViaTerminal(interUsed, home.name, workCity.name, workOp?.info.name));
    } else if (busStops.length) {
      // No useful terminal in the work city: a direct estimated bus to near work.
      const workStops = await fetchBusStops(bboxAround(req.work, 1500)).catch(() => []);
      const workStop = new PointIndex(workStops, 500, req.work.lat).nearest(req.work, DEFAULT_TRANSIT.busWalkAtWorkM);
      if (workStop) {
        fallback = { busStops, workStopDistM: workStop.dist, intercity: true };
        warn(msg.estimatedDirectIntercity(home.name, workCity.name));
      }
    }
    if (!fallback && !homeIds.size) warn(msg.noConnection(home.name, workCity.name));
  }

  // Where the estimated leg starts on the map: the bus stop closest to the city center.
  const origin =
    new PointIndex(inter.homeStops, 500, home.lat).nearest(home, 3000)?.item ??
    ({ lat: home.lat, lng: home.lng } as LatLng);
  const legs = (used: string[]): TransitRoute[] =>
    hubs
      .filter((h) => used.includes(h.id))
      .map((h) => ({
        id: `intercity-est-${h.id}`,
        name: msg.estimatedLegName(home.name, h.name),
        mode: "bus" as const,
        color: ESTIMATED_COLOR,
        path: [
          [origin.lat, origin.lng],
          [h.lat, h.lng],
        ],
        estimated: true,
        kind: "estimated" as const,
      }));

  return {
    routes,
    stops,
    // Lines near work and intercity lines go to the map; of the work city's network, only those the regions use
    // (the whole network has more than a hundred lines).
    nearWorkIds: new Set([...near.ids, ...nearWork(homeRoutes, req.work).ids]),
    intercityIds: interHomeIds,
    fallback,
    hubs,
    legs,
  };
}
