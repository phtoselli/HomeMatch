import type { BBox, Cell, FeatureRequest, LatLng, Poi, Polygon, Region, RegionLevel } from "@homematch/contracts";
import { PointIndex, bboxOf, gridCenters, inMultiPolygon, padBBox } from "../geo.js";
import { commuteFrom, genericBusCommute, type BoardingStop, type Commute } from "../transit/model.js";
import { hubCommute, type Hub } from "../transit/intercity.js";
import {
  IMPORTANCE,
  TRANSIT_CRITERION,
  commuteRef,
  criteriaScore,
  levelOf,
  levelRank,
  type CriterionResult,
} from "./levels.js";

export interface GridInput {
  bbox: BBox;
  boundary?: Polygon[];
  work: LatLng;
  cellSizeM: number;
  maxWalkToStopM: number;
  /** Importância do transporte até o trabalho (0 = não conta). */
  transitWeight: number;
  /** Lugares que a pessoa quer perto, com raio e importância. */
  features: FeatureRequest[];
  pois: Record<string, Poi[]>;
  stops: BoardingStop[];
  places: { lat: number; lng: number; name: string; rank: number }[];
  /** Pontos das linhas que a pessoa escolheu: perto deles, o transporte conta como atingido. */
  preferredStops?: LatLng[];
  /** Sem linhas mapeadas: ônibus estimado entre pontos. `intercity` = o trabalho fica em outra cidade. */
  fallback?: { busStops: LatLng[]; workStopDistM: number; intercity?: boolean };
  /**
   * Trabalho em outra cidade sem linha intermunicipal mapeada: terminais de lá (com o caminho até o trabalho).
   * Com eles, o intermunicipal estimado vai até o terminal (e não até a porta do trabalho). Usa `fallback.busStops`.
   */
  hubs?: Hub[];
}

export interface GridOutput {
  /** Só as áreas com nível (as outras não entram na busca de imóveis). */
  cells: Cell[];
  cellsTotal: number;
  levels: Record<RegionLevel, number>;
  commuteBestMin: number;
  commuteRefMin: number;
  /** Terminais (`Hub.id`) que alguma célula mantida usa. */
  hubsUsed: string[];
}

/** Até onde guardar a distância de um lugar além do raio pedido (para o card dizer "parque a 2,1 km"). */
const INFO_REACH = 3;

/** Critérios da busca, na ordem: transporte primeiro (ganha no empate de peso), depois os lugares. */
export function criteriaOf(transitWeight: number, features: FeatureRequest[]): { id: string; weight: number }[] {
  const out = [
    ...(transitWeight > 0 ? [{ id: TRANSIT_CRITERION, weight: transitWeight }] : []),
    ...features.map((f) => ({ id: f.id, weight: f.weight })),
  ];
  // Sem nada pedido, o transporte decide (senão nenhuma região teria nível).
  return out.length ? out : [{ id: TRANSIT_CRITERION, weight: IMPORTANCE.main }];
}

/**
 * Parte pura da análise: percorre a cidade inteira, calcula o tempo até o trabalho (sem limite) e a distância até
 * cada lugar pedido, e dá a cada área um nível (excelente, boa, ok ou fora) pelas prioridades da pessoa.
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

  // 1ª passada: tempo até o trabalho de cada área (o melhor da cidade define o que é "bem servido").
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
  const best = commutes.reduce((m, c) => Math.min(m, c.minutes), Infinity);
  const ref = commuteRef(best);

  // 2ª passada: critérios atingidos, nível e nota.
  const cells: Cell[] = [];
  const levels: Record<RegionLevel, number> = { excelente: 0, boa: 0, ok: 0 };
  const hubsUsed = new Set<string>();
  centers.forEach((c, i) => {
    const commute = commutes[i]!;
    const results: CriterionResult[] = [];
    const featureDist: Record<string, number> = {};
    for (const cr of criteria) {
      if (cr.id === TRANSIT_CRITERION) {
        const t = commute.minutes;
        const inTime = t <= ref;
        const nearLine = !!prefIdx?.nearest(c, input.maxWalkToStopM);
        let fit = inTime ? 0.5 + 0.5 * Math.max(0, Math.min(1, (ref - t) / Math.max(1, ref - best))) : 0;
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
    hubsUsed: [...hubsUsed],
  };
}

/** Agrupa as células por bairro e ordena: primeiro o nível (o melhor da região), depois a nota. */
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
    // A nota da região vem das melhores áreas do melhor nível dela.
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
      score: Math.round((top.reduce((s, c) => s + c.score, 0) / top.length) * 10) / 10,
      cellCount: cs.length,
      via: [...via.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([v]) => v),
      featureDist,
      level: bestCell.level,
      hits: bestCell.hits,
    });
  }
  regions.sort((a, b) => levelRank(b.level) - levelRank(a.level) || b.score - a.score || a.commuteMin - b.commuteMin);
  return regions.map((r, i) => ({ ...r, rank: i + 1 }));
}
