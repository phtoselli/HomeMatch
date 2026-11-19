import type { BBox, Cell, FeatureRequest, LatLng, Poi, Polygon, Region, RegionLevel } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { PointIndex, bboxOf, gridCenters, inMultiPolygon, padBBox } from "../geo.js";
import { commuteFrom, genericBusCommute, type BoardingStop, type Commute } from "../transit/model.js";
import { hubCommute, type Hub } from "../transit/intercity.js";
import {
  IMPORTANCE,
  TRANSIT_CRITERION,
  commuteRef,
  noTransitNear,
  criteriaScore,
  directRef,
  transitFit,
  levelOf,
  levelRank,
  type CriterionResult,
} from "./levels.js";

export interface GridInput {
  bbox: BBox;
  boundary?: Polygon[];
  work: LatLng;
  /** City name: names cells far from any mapped neighborhood ("Paulínia, north side"). */
  cityName?: string;
  cellSizeM: number;
  maxWalkToStopM: number;
  /** Importance of transit to work (0 = ignored). */
  transitWeight: number;
  /** Places the user wants nearby, with radius and importance. */
  features: FeatureRequest[];
  pois: Record<string, Poi[]>;
  stops: BoardingStop[];
  places: { lat: number; lng: number; name: string; rank: number }[];
  /** Stops of the lines the user picked: near them, transit counts as met. */
  preferredStops?: LatLng[];
  /** No mapped lines: estimated bus between stops. `intercity` = work is in another city. */
  fallback?: { busStops: LatLng[]; workStopDistM: number; intercity?: boolean };
  /**
   * Work in another city with no mapped intercity line: that city's terminals (with the way on to work).
   * With them, the estimated intercity bus ends at a terminal (not at the office door). Uses `fallback.busStops`.
   */
  hubs?: Hub[];
}

export interface GridOutput {
  /** Only cells with a level (the others are left out of the listing search). */
  cells: Cell[];
  cellsTotal: number;
  levels: Record<RegionLevel, number>;
  commuteBestMin: number;
  commuteRefMin: number;
  /** Limit on a direct line (no transfer), above `commuteRefMin`. */
  commuteDirectRefMin: number;
  /** Terminals (`Hub.id`) used by some kept cell. */
  hubsUsed: string[];
}

/** How far beyond the requested radius a place's distance is kept (so a card can say "park 2.1 km away"). */
const INFO_REACH = 3;

/** Search criteria, in order: transit first (wins weight ties), then places. */
export function criteriaOf(transitWeight: number, features: FeatureRequest[]): { id: string; weight: number }[] {
  const out = [
    ...(transitWeight > 0 ? [{ id: TRANSIT_CRITERION, weight: transitWeight }] : []),
    ...features.map((f) => ({ id: f.id, weight: f.weight })),
  ];
  // With nothing requested, transit decides (otherwise no region would get a level).
  return out.length ? out : [{ id: TRANSIT_CRITERION, weight: IMPORTANCE.main }];
}

/**
 * Pure part of the analysis: walks the whole city, computes the commute (no limit) and the distance to each
 * requested place, and gives each cell a level (excellent, good, ok or out) from the user's priorities.
 */
export function scoreGrid(input: GridInput): GridOutput {
  const { work, features } = input;
  const stopIdx = new PointIndex(input.stops, 1000, work.lat);
  const poiIdx = Object.fromEntries(
    features.map((f) => [f.id, new PointIndex(input.pois[f.id] ?? [], Math.max(500, f.radius), work.lat)]),
  );
  const placeIdx = new PointIndex(input.places, 2000, work.lat);
  const fbIdx = input.fallback ? new PointIndex(input.fallback.busStops, 500, work.lat) : null;
  const prefIdx = input.preferredStops?.length ? new PointIndex(input.preferredStops, 500, work.lat) : null;
  const hubs = input.hubs ?? [];
  const criteria = criteriaOf(input.transitWeight, features);

  // 1st pass: commute of each cell (the city's best defines what "well served" means).
  const centers = gridCenters(input.bbox, input.cellSizeM).filter(
    (c) => !input.boundary || inMultiPolygon(c, input.boundary),
  );
  const commutes = centers.map((c) => {
    let commute: Commute & { hubId?: string } = commuteFrom(c, work, stopIdx, input.maxWalkToStopM);
    if (fbIdx && hubs.length) {
      const h = hubCommute(c, fbIdx, hubs, input.maxWalkToStopM);
      if (h && h.minutes < commute.minutes) commute = h;
    } else if (fbIdx && input.fallback) {
      const g = genericBusCommute(
        c,
        work,
        fbIdx,
        input.maxWalkToStopM,
        input.fallback.workStopDistM,
        undefined,
        input.fallback.intercity,
      );
      if (g && g.minutes < commute.minutes) commute = g;
    }
    return commute;
  });
  // A long walk (no bus nearby) is not transit: it counts neither for the best time nor as met.
  const usable = (c: Commute) => !noTransitNear({ travel: c.travel, commuteMin: c.minutes });
  const best = commutes.reduce((m, c) => (usable(c) ? Math.min(m, c.minutes) : m), Infinity);
  // The reference comes from the best ride, not from the few blocks next to work that are reached on foot.
  const bestRide = commutes.reduce((m, c) => (c.travel !== "walk" ? Math.min(m, c.minutes) : m), Infinity);
  const ref = commuteRef(Number.isFinite(bestRide) ? bestRide : best);

  // 2nd pass: criteria met, level and score.
  const cells: Cell[] = [];
  const levels: Record<RegionLevel, number> = { excellent: 0, good: 0, ok: 0 };
  const hubsUsed = new Set<string>();
  centers.forEach((c, i) => {
    const commute = commutes[i]!;
    const results: CriterionResult[] = [];
    const featureDist: Record<string, number> = {};
    for (const cr of criteria) {
      if (cr.id === TRANSIT_CRITERION) {
        const nearLine = !!prefIdx?.nearest(c, input.maxWalkToStopM);
        let fit = usable(commute) ? transitFit(commute, best, ref) : 0;
        const inTime = fit > 0;
        if (nearLine) fit = Math.max(fit, 0.85);
        results.push({ id: cr.id, weight: cr.weight, hit: inTime || nearLine, fit });
        continue;
      }
      const f = features.find((x) => x.id === cr.id)!;
      const near = poiIdx[f.id]!.nearest(c, f.radius * INFO_REACH);
      if (near) featureDist[f.id] = Math.round(near.dist);
      const hit = !!near && near.dist <= f.radius;
      results.push({ id: f.id, weight: cr.weight, hit, fit: hit ? 1 - (0.5 * near!.dist) / f.radius : 0 });
    }
    const level = levelOf(results);
    if (!level) return;
    levels[level]++;
    if (commute.hubId) hubsUsed.add(commute.hubId);

    const place = placeName(c, placeIdx, input.bbox, input.cityName);

    cells.push({
      id: `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`,
      // ~1 m: enough for the map and keeps the answer small (there are thousands of cells).
      lat: round5(c.lat),
      lng: round5(c.lng),
      commuteMin: Math.round(commute.minutes),
      travel: commute.travel,
      via: commute.via,
      routeId: commute.routeId,
      featureDist,
      score: criteriaScore(results),
      region: place,
      level,
      hits: results.filter((r) => r.hit).map((r) => r.id),
    });
  });
  return {
    cells,
    cellsTotal: centers.length,
    levels,
    commuteBestMin: Number.isFinite(best) ? Math.round(best) : 0,
    commuteRefMin: ref,
    commuteDirectRefMin: directRef(ref),
    hubsUsed: [...hubsUsed],
  };
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** How far a neighborhood names the cells around it and, with none close, the farthest one still used. */
export const PLACE_REACH = { nearM: 2500, farM: 6000 };

/**
 * Name of a cell: the most "important" neighborhood (official > suburb > quarter > neighbourhood > development)
 * among the closest ones; with none close, the closest within 6 km; with none at all, the city and side of town
 * ("Paulínia, north side"). Never coordinates: the name is shown to the user and used to search portals.
 */
export function placeName(
  c: LatLng,
  places: PointIndex<{ lat: number; lng: number; name: string; rank: number }>,
  bbox: BBox,
  cityName: string = t.regions.fallbackCity,
): string {
  const near = places.within(c, PLACE_REACH.nearM).sort((a, b) => a.dist - b.dist);
  if (near.length)
    return near.slice(0, 3).sort((a, b) => a.dist + a.item.rank * 400 - (b.dist + b.item.rank * 400))[0]!.item.name;
  const far = places.nearest(c, PLACE_REACH.farM);
  if (far) return far.item.name;
  return t.regions.citySide(cityName, t.regions.sides[sideOf(c, bbox)]);
}

export type CitySide =
  "center" | "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest";

/** Side of town from the position relative to the bbox center (center, north, southeast…). */
export function sideOf(c: LatLng, bbox: BBox): CitySide {
  const center = { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 };
  const dy = (c.lat - center.lat) * 111_320;
  const dx = (c.lng - center.lng) * 111_320 * Math.cos((center.lat * Math.PI) / 180);
  if (Math.hypot(dx, dy) < 2000) return "center";
  const ns = dy > Math.abs(dx) / 2 ? "north" : dy < -Math.abs(dx) / 2 ? "south" : "";
  const ew = dx > Math.abs(dy) / 2 ? "east" : dx < -Math.abs(dy) / 2 ? "west" : "";
  return ((ns + ew) as CitySide) || "center";
}

/** Groups cells by neighborhood and sorts: level first (the region's best), then score. */
export function rankRegions(cells: Cell[], cellSizeM: number): Region[] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells) {
    let g = groups.get(c.region);
    if (!g) groups.set(c.region, (g = []));
    g.push(c);
  }
  const regions: Omit<Region, "rank">[] = [];
  for (const [name, cs] of groups) {
    cs.sort((a, b) => levelRank(b.level) - levelRank(a.level) || b.score - a.score);
    const bestCell = cs[0]!;
    // The region's score comes from the best cells of its best level.
    const top = cs.filter((c) => c.level === bestCell.level).slice(0, 3);
    const via = new Map<string, number>();
    for (const c of cs) via.set(c.via, (via.get(c.via) ?? 0) + 1);
    const featureDist: Record<string, number> = {};
    for (const c of cs) {
      for (const [k, d] of Object.entries(c.featureDist)) featureDist[k] = Math.min(featureDist[k] ?? Infinity, d);
    }
    const lat = cs.reduce((s, c) => s + c.lat, 0) / cs.length;
    const lng = cs.reduce((s, c) => s + c.lng, 0) / cs.length;
    regions.push({
      id: name,
      name,
      lat,
      lng,
      bbox: padBBox(bboxOf(cs), cellSizeM / 2),
      commuteMin: Math.min(...cs.map((c) => c.commuteMin)),
      commuteAvg: Math.round(cs.reduce((s, c) => s + c.commuteMin, 0) / cs.length),
      travel: bestCell.travel,
      score: Math.round((top.reduce((s, c) => s + c.score, 0) / top.length) * 10) / 10,
      cellCount: cs.length,
      // The best cell's route first (it defines the level), then the most common ones.
      via: [
        bestCell.via,
        ...[...via.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([v]) => v)
          .filter((v) => v !== bestCell.via),
      ].slice(0, 4),
      featureDist,
      level: bestCell.level,
      hits: bestCell.hits,
    });
  }
  regions.sort((a, b) => levelRank(b.level) - levelRank(a.level) || b.score - a.score || a.commuteMin - b.commuteMin);
  return regions.map((r, i) => ({ ...r, rank: i + 1 }));
}
