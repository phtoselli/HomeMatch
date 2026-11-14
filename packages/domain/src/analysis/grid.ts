import type { BBox, Cell, FeatureRequest, LatLng, Poi, Polygon, Region } from "@homematch/contracts";
import { PointIndex, bboxOf, gridCenters, inMultiPolygon, padBBox } from "../geo.js";
import { commuteFrom, genericBusCommute, type BoardingStop } from "../transit/model.js";

export interface GridInput {
  bbox: BBox;
  boundary?: Polygon[];
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
  /** Mantém também o que passa por pouco (ver AnalyzeRequest.flex). */
  flex?: boolean;
}

export interface GridOutput {
  cells: Cell[];
  cellsTotal: number;
  cellsReachable: number;
  /** Quantas das células mantidas atendem a tudo (sem flex, todas). */
  cellsMatching: number;
}

/** Busca flexível: quanto além do pedido ainda entra como "quase lá". */
export const FLEX = { extraMin: 15, radiusFactor: 2, maxMisses: 2, penalty: 0.7 };

/** Tempo máximo que a análise considera (com a folga da busca flexível). */
export const commuteLimit = (maxCommuteMin: number, flex?: boolean) => maxCommuteMin + (flex ? FLEX.extraMin : 0);

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
  let matching = 0;
  const flex = !!input.flex;
  const limit = commuteLimit(input.maxCommuteMin, flex);
  const reach = (r: number) => (flex ? r * FLEX.radiusFactor : r);
  for (const c of centers) {
    if (input.boundary && !inMultiPolygon(c, input.boundary)) continue;
    let commute = commuteFrom(c, work, stopIdx, input.maxWalkToStopM);
    if (fbIdx && input.fallback) {
      const g = genericBusCommute(c, work, fbIdx, input.maxWalkToStopM, input.fallback.workStopDistM);
      if (g && g.minutes < commute.minutes) commute = g;
    }
    if (commute.minutes > limit) continue;
    if (commute.minutes <= input.maxCommuteMin) reachable++;

    // Sem flex, falta qualquer coisa = fora. Com flex, cada falta só pesa na nota (até FLEX.maxMisses).
    let misses = commute.minutes > input.maxCommuteMin ? 1 : 0;
    const featureDist: Record<string, number> = {};
    let amenity = 0;
    for (const f of features) {
      const near = poiIdx[f.id]!.nearest(c, reach(f.radius));
      if (near) featureDist[f.id] = Math.round(near.dist);
      if (near && near.dist <= f.radius) amenity += 1 - near.dist / f.radius;
      else misses++;
      if (!flex && misses) break;
    }
    if (misses > (flex ? FLEX.maxMisses : 0)) continue;
    if (!misses) matching++;

    const amenityScore = features.length ? amenity / features.length : 1;
    const commuteScore = Math.max(0, 1 - commute.minutes / input.maxCommuteMin);
    const w = features.length ? input.commuteWeight : 1;
    const score = 100 * (w * commuteScore + (1 - w) * amenityScore) * FLEX.penalty ** misses;

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
      ...(flex ? { misses } : {}),
    });
  }
  return { cells, cellsTotal: centers.length, cellsReachable: reachable, cellsMatching: matching };
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
      via: [...via.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([v]) => v),
      featureDist,
      ...(cs.some((c) => c.misses != null) ? { misses: Math.min(...cs.map((c) => c.misses ?? 0)) } : {}),
    });
  }
  // Primeiro as regiões que atendem a tudo; depois as que chegam perto (busca flexível).
  regions.sort((a, b) => (a.misses ?? 0) - (b.misses ?? 0) || b.score - a.score || a.commuteMin - b.commuteMin);
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
