import type {
  AnalysisResult,
  AnalyzeRequest,
  BBox,
  Cell,
  FeatureRequest,
  LatLng,
  Poi,
  Region,
} from "../shared/types.js";
import { fetchFeaturePois, fetchPlaceNames, featureById } from "./features.js";
import { PointIndex, bboxOf, gridCenters, inMultiPolygon, padBBox } from "./geo.js";
import {
  DEFAULT_TRANSIT,
  boardingStops,
  commuteFrom,
  fetchBusStops,
  fetchRoutesNearWork,
  genericBusCommute,
  type BoardingStop,
  type ParsedRoute,
} from "./transit.js";
import { operatorFor } from "./operators/index.js";

/** Abaixo disso, consideramos que as linhas da cidade não estão bem mapeadas no OSM. */
const FEW_ROUTES = 8;

export type Emit = (ev: { type: "progress" | "warning"; message: string }) => void;

export interface GridInput {
  bbox: BBox;
  boundary?: AnalyzeRequest["city"]["boundary"];
  work: LatLng;
  cellSizeM: number;
  maxCommuteMin: number;
  maxWalkToStopM: number;
  commuteWeight: number;
  features: FeatureRequest[];
  pois: Record<string, Poi[]>;
  stops: BoardingStop[];
  places: { lat: number; lng: number; name: string; rank: number }[];
  /** Modo reserva (poucas linhas no OSM): pontos de ônibus da cidade + distância do trabalho ao ponto mais próximo. */
  fallback?: { busStops: LatLng[]; workStopDistM: number };
}

export interface GridOutput {
  cells: Cell[];
  cellsTotal: number;
  cellsReachable: number;
}

/**
 * Parte pura da análise: percorre a grade, calcula o trajeto e a distância até cada
 * característica, mantém só as células que atendem a TUDO e dá uma nota de 0 a 100.
 */
export function scoreGrid(input: GridInput): GridOutput {
  const { work, features } = input;
  const stopIdx = new PointIndex(input.stops, 1000, work.lat);
  const poiIdx = Object.fromEntries(
    features.map((f) => [f.id, new PointIndex(input.pois[f.id] ?? [], Math.max(500, f.radius), work.lat)]),
  );
  const placeIdx = new PointIndex(input.places, 2000, work.lat);
  const fbIdx = input.fallback ? new PointIndex(input.fallback.busStops, 500, work.lat) : null;

  const centers = gridCenters(input.bbox, input.cellSizeM);
  const cells: Cell[] = [];
  let reachable = 0;
  for (const c of centers) {
    if (input.boundary && !inMultiPolygon(c, input.boundary)) continue;
    let commute = commuteFrom(c, work, stopIdx, input.maxWalkToStopM);
    if (fbIdx && input.fallback) {
      const g = genericBusCommute(c, work, fbIdx, input.maxWalkToStopM, input.fallback.workStopDistM);
      if (g && g.minutes < commute.minutes) commute = g;
    }
    if (commute.minutes > input.maxCommuteMin) continue;
    reachable++;

    const featureDist: Record<string, number> = {};
    let ok = true;
    let amenity = 0;
    for (const f of features) {
      const near = poiIdx[f.id]!.nearest(c, f.radius);
      if (!near) {
        ok = false;
        break;
      }
      featureDist[f.id] = Math.round(near.dist);
      amenity += 1 - near.dist / f.radius;
    }
    if (!ok) continue;

    const amenityScore = features.length ? amenity / features.length : 1;
    const commuteScore = 1 - commute.minutes / input.maxCommuteMin;
    const w = features.length ? input.commuteWeight : 1;
    const score = 100 * (w * commuteScore + (1 - w) * amenityScore);

    // Nome do bairro: o place mais "importante" (suburb > quarter > neighbourhood) entre os mais próximos.
    const nearPlaces = placeIdx.within(c, 2500).sort((a, b) => a.dist - b.dist);
    const place = nearPlaces.length
      ? nearPlaces.slice(0, 3).sort((a, b) => a.dist + a.item.rank * 400 - (b.dist + b.item.rank * 400))[0]!.item.name
      : `Região ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;

    cells.push({
      id: `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`,
      lat: c.lat,
      lng: c.lng,
      commuteMin: Math.round(commute.minutes),
      via: commute.via,
      routeId: commute.routeId,
      featureDist,
      score: Math.round(score * 10) / 10,
      region: place,
    });
  }
  return { cells, cellsTotal: centers.length, cellsReachable: reachable };
}

/** Agrupa as células por bairro e ordena (média das 3 melhores notas). */
export function rankRegions(cells: Cell[], cellSizeM: number): Region[] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells) {
    let g = groups.get(c.region);
    if (!g) groups.set(c.region, (g = []));
    g.push(c);
  }
  const regions: Omit<Region, "rank">[] = [];
  for (const [name, cs] of groups) {
    cs.sort((a, b) => b.score - a.score);
    const top = cs.slice(0, 3);
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
      score: Math.round((top.reduce((s, c) => s + c.score, 0) / top.length) * 10) / 10,
      cellCount: cs.length,
      via: [...via.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v),
      featureDist,
    });
  }
  regions.sort((a, b) => b.score - a.score || a.commuteMin - b.commuteMin);
  return regions.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Limita a área de análise: bbox da cidade, cortada a um raio razoável em volta do trabalho. */
export function analysisBBox(cityBBox: BBox, work: LatLng, maxCommuteMin: number): BBox {
  // Nenhum transporte urbano direto passa de ~35 km/h de média: corta o que é inalcançável.
  const reachM = Math.min(40_000, (maxCommuteMin / 60) * 35_000);
  const around = padBBox({ south: work.lat, north: work.lat, west: work.lng, east: work.lng }, reachM);
  return {
    south: Math.max(cityBBox.south, around.south),
    north: Math.min(cityBBox.north, around.north),
    west: Math.max(cityBBox.west, around.west),
    east: Math.min(cityBBox.east, around.east),
  };
}

export async function analyze(req: AnalyzeRequest, emit: Emit): Promise<AnalysisResult> {
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    emit({ type: "warning", message: m });
  };
  const bbox = analysisBBox(req.city.bbox, req.work, req.maxCommuteMin);

  const op = operatorFor(req.city);
  let routes: ParsedRoute[] = [];
  if (op) {
    emit({ type: "progress", message: `Baixando as linhas oficiais de ${op.info.name} (trajetos e pontos)…` });
    routes = await op.routes().catch((e) => {
      warn(`Não deu para ler as linhas de ${op.info.name}: ${(e as Error).message}. Usando o OpenStreetMap.`);
      return [];
    });
  }
  // Com a rede oficial em mãos, não espera o Overpass (lento e muitas vezes lotado).
  if (!routes.length) {
    emit({ type: "progress", message: "Buscando linhas de ônibus, metrô e trem que passam perto do trabalho…" });
    routes = await fetchRoutesNearWork(req.work, DEFAULT_TRANSIT);
  }
  // Com a rede inteira do operador dá para considerar uma baldeação; com o OSM só há as linhas perto do trabalho.
  const transfers = !!op && routes.length > 0;
  const direct = boardingStops(routes, req.work, DEFAULT_TRANSIT);
  const stops = transfers ? boardingStops(routes, req.work, DEFAULT_TRANSIT, { transfers: true }) : direct;
  const usedIds = new Set(stops.map((s) => s.routeId));
  const directIds = new Set(direct.map((s) => s.routeId));
  const nearCount = new Set(routes.filter((r) => directIds.has(r.id)).map((r) => r.ref ?? r.id)).size;
  const viaCount = new Set(routes.filter((r) => usedIds.has(r.id)).map((r) => r.ref ?? r.id)).size;
  emit({
    type: "progress",
    message:
      `${nearCount} linhas passam perto do trabalho${op ? ` (fonte: ${op.info.name})` : ""}` +
      (transfers ? `; com uma baldeação, ${viaCount} linhas levam até lá` : "") +
      ` — ${stops.length} pontos de embarque.`,
  });
  let fallback: GridInput["fallback"];
  if (nearCount < FEW_ROUTES && !(op && nearCount > 0)) {
    emit({ type: "progress", message: "Poucas linhas mapeadas no OpenStreetMap aqui; buscando os pontos de ônibus da cidade…" });
    const busStops = await fetchBusStops(bbox).catch(() => []);
    const workStop = new PointIndex(busStops, 500, req.work.lat).nearest(req.work, DEFAULT_TRANSIT.busWalkAtWorkM);
    if (workStop) {
      fallback = { busStops, workStopDistM: workStop.dist };
      warn(
        `Só ${nearCount} linha(s) com itinerário no OpenStreetMap perto do trabalho. Para o resto, o tempo é ` +
          `"ônibus (estimado)": ponto perto de casa + ponto perto do trabalho, em linha quase reta a 15 km/h. ` +
          `Confira a linha real no modo "Meus links".`,
      );
    } else if (!nearCount) {
      warn("Nenhuma linha nem ponto de ônibus no OpenStreetMap perto do trabalho; só a caminhada foi considerada.");
    }
  }

  const pois: Record<string, Poi[]> = {};
  for (const f of req.features) {
    const def = featureById(f.id);
    emit({ type: "progress", message: `Mapeando ${def?.label.toLowerCase() ?? f.id} na cidade…` });
    pois[f.id] = await fetchFeaturePois(f.id, padBBox(bbox, f.radius));
    if (!pois[f.id]!.length) warn(`Nenhum(a) ${def?.label ?? f.id} encontrado(a) no OpenStreetMap nessa área.`);
  }

  emit({ type: "progress", message: "Buscando nomes dos bairros…" });
  const places = await fetchPlaceNames(padBBox(bbox, 2000)).catch((e) => {
    warn(`Não deu para buscar os nomes dos bairros: ${(e as Error).message}`);
    return [];
  });

  emit({ type: "progress", message: "Cruzando trajeto e características em cada pedaço da cidade…" });
  const grid = scoreGrid({
    bbox,
    boundary: req.city.boundary,
    work: req.work,
    cellSizeM: req.cellSizeM,
    maxCommuteMin: req.maxCommuteMin,
    maxWalkToStopM: req.maxWalkToStopM,
    commuteWeight: req.commuteWeight,
    features: req.features,
    pois,
    stops,
    places,
    fallback,
  });
  const regions = rankRegions(grid.cells, req.cellSizeM);
  const cellRouteIds = new Set(grid.cells.map((c) => c.routeId).filter((id): id is string => !!id));
  if (!grid.cells.length) {
    warn("Nenhuma região atende a tudo. Tente aumentar o tempo máximo ou os raios das características.");
  }

  // Envia ao mapa só os POIs dentro da área analisada (e as linhas usadas).
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
    // Só as linhas que chegam ao trabalho e as que as regiões encontradas usam (a rede inteira pesa MBs).
    routes: routes
      .filter((r) => directIds.has(r.id) || cellRouteIds.has(r.id))
      .map(({ ptv2: _p, alightOnly: _a, ...r }) => r),
    pois: trimmed,
    cells: grid.cells,
    regions,
    stats: {
      cellsTotal: grid.cellsTotal,
      cellsReachable: grid.cellsReachable,
      cellsMatching: grid.cells.length,
      stopsUsable: stops.length,
    },
    warnings,
  };
}
