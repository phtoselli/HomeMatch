import type { AnalysisResult, AnalyzeRequest, Emit, Poi } from "@homematch/contracts";
import { inBBox, inMultiPolygon, padBBox, rankRegions, scoreGrid } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { featureById, fetchFeaturePois, fetchPlaceNames } from "@homematch/sources";
import { intercityNetwork, localNetwork, osmArea } from "./commute.js";

/** How many of the best regions bring their lines to the map (the same ones the listing search goes through). */
const MAP_REGIONS = 15;

const msg = t.analysis;

/**
 * Region analysis: downloads lines, places and neighborhoods (sources) and crosses everything on the grid (domain).
 * Notices go out through `emit` while it works.
 */
export async function analyze(req: AnalyzeRequest, emit: Emit): Promise<AnalysisResult> {
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    emit({ type: "warning", message: m });
  };
  // No maximum commute, so the whole city is analyzed: each cell gets a level from the user's priorities.
  const bbox = req.city.bbox;

  // By the municipal boundary: neighboring cities' bboxes overlap.
  const workInCity = req.city.boundary?.length
    ? inMultiPolygon(req.work, req.city.boundary)
    : inBBox(req.work, req.city.bbox);
  // Places and neighborhoods are fetched alongside the lines (Overpass is slow: better to wait only once).
  // A failing query (Overpass at capacity) becomes a warning and the analysis goes on with the rest.
  const failedPois: string[] = [];
  const poisPromise = Promise.all(
    req.features.map(async (f) => {
      // 2× radius margin: a place just across the city line counts too (and the query stays cache-compatible).
      const list = await fetchFeaturePois(f.id, osmArea(req.city.bbox, f.radius * 2)).catch(() => {
        failedPois.push(f.id);
        return [] as Poi[];
      });
      return [f.id, list] as const;
    }),
  );
  const placesPromise = fetchPlaceNames(osmArea(req.city.bbox, 2000));
  // Avoid an "unhandled rejection" while lines are still loading; the error is handled below.
  placesPromise.catch(() => {});

  const net = workInCity ? await localNetwork(req, emit, warn, true) : await intercityNetwork(req, emit, warn);
  const { routes, stops } = net;

  if (req.features.length) {
    const labels = req.features.map((f) => featureById(f.id)?.label.toLowerCase() ?? f.id);
    emit({ type: "progress", message: msg.mappingPlaces(labels) });
  }
  const pois: Record<string, Poi[]> = Object.fromEntries(await poisPromise);
  for (const f of req.features) {
    const label = featureById(f.id)?.label ?? f.id;
    if (failedPois.includes(f.id)) warn(msg.placesUnavailable(label));
    else if (!pois[f.id]!.length) warn(msg.noPlaces(label));
  }
  const places = await placesPromise.catch(() => {
    warn(msg.neighborhoodsUnavailable);
    return [];
  });

  emit({ type: "progress", message: msg.scoring });
  const grid = scoreGrid({
    bbox,
    boundary: req.city.boundary,
    work: req.work,
    cityName: req.city.name,
    cellSizeM: req.cellSizeM,
    maxWalkToStopM: req.maxWalkToStopM,
    transitWeight: req.transitWeight,
    features: req.features,
    pois,
    stops,
    places,
    preferredStops: req.preferredStops?.map(([lat, lng]) => ({ lat, lng })),
    fallback: net.fallback,
    hubs: net.hubs,
  });
  const regions = rankRegions(grid.cells, req.cellSizeM);
  // Lines used by the best regions (the ones in the listing search); the whole city would weigh megabytes.
  const topNames = new Set(regions.slice(0, MAP_REGIONS).map((r) => r.name));
  const cellRouteIds = new Set(grid.cells.filter((c) => topNames.has(c.region) && c.routeId).map((c) => c.routeId!));
  const { excellent, good, ok } = grid.levels;
  if (!grid.cells.length) warn(msg.noRegions);
  else if (!excellent && !good) warn(msg.mainNotMet);
  emit({
    type: "progress",
    message: msg.levelsSummary(excellent, good, ok, grid.commuteBestMin, grid.commuteRefMin),
  });

  // Only send the places inside the analyzed area to the map (and the lines used).
  const box = padBBox(bbox, 1000);
  const trimmed = Object.fromEntries(
    Object.entries(pois).map(([k, v]) => [
      k,
      v.filter((p) => p.lat >= box.south && p.lat <= box.north && p.lng >= box.west && p.lng <= box.east),
    ]),
  );

  return {
    work: req.work,
    cellSizeM: req.cellSizeM,
    // Only the lines that reach work and those the found regions use (the whole network weighs megabytes), plus the
    // estimated intercity legs to the terminals the regions use.
    routes: [
      ...routes
        .filter((r) => net.nearWorkIds.has(r.id) || net.intercityIds.has(r.id) || cellRouteIds.has(r.id))
        .map(({ ptv2: _p, alightOnly: _a, ...r }) => ({
          ...r,
          kind: net.nearWorkIds.has(r.id)
            ? ("nearWork" as const)
            : net.intercityIds.has(r.id)
              ? ("intercity" as const)
              : ("feeder" as const),
        })),
      ...net.legs(grid.hubsUsed),
    ],
    pois: trimmed,
    cells: grid.cells,
    regions,
    stats: {
      cellsTotal: grid.cellsTotal,
      levels: grid.levels,
      commuteBestMin: grid.commuteBestMin,
      commuteRefMin: grid.commuteRefMin,
      stopsUsable: stops.length,
    },
    warnings,
  };
}
