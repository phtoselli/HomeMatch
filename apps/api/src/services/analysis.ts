import type { AnalysisResult, AnalyzeRequest, Emit, Poi } from "@homematch/contracts";
import {
  FLEX,
  analysisBBox,
  commuteLimit,
  inBBox,
  inMultiPolygon,
  padBBox,
  rankRegions,
  scoreGrid,
} from "@homematch/domain";
import { featureById, fetchFeaturePois, fetchPlaceNames } from "@homematch/sources";
import { intercityNetwork, localNetwork, osmArea } from "./commute.js";

/**
 * Análise das regiões: baixa linhas, lugares e bairros (fontes) e cruza tudo na grade (domínio).
 * Os avisos vão saindo por `emit` enquanto trabalha.
 */
export async function analyze(req: AnalyzeRequest, emit: Emit): Promise<AnalysisResult> {
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    emit({ type: "warning", message: m });
  };
  const bbox = analysisBBox(req.city.bbox, req.work, commuteLimit(req.maxCommuteMin, req.flex));

  // Pelo limite do município: as bboxes de cidades vizinhas se sobrepõem.
  const workInCity = req.city.boundary?.length
    ? inMultiPolygon(req.work, req.city.boundary)
    : inBBox(req.work, req.city.bbox);
  // Lugares e bairros saem junto com as linhas (o Overpass é lento: melhor esperar uma vez só).
  const poisPromise = Promise.all(
    req.features.map(async (f) => {
      const pad = req.flex ? f.radius * FLEX.radiusFactor : f.radius;
      return [f.id, await fetchFeaturePois(f.id, osmArea(req.city.bbox, pad))] as const;
    }),
  );
  const placesPromise = fetchPlaceNames(osmArea(req.city.bbox, 2000));
  // Evita "unhandled rejection" enquanto as linhas ainda estão sendo lidas; o erro é tratado lá embaixo.
  poisPromise.catch(() => {});
  placesPromise.catch(() => {});

  const net = workInCity ? await localNetwork(req, emit, warn, true) : await intercityNetwork(req, emit, warn);
  const { routes, stops } = net;

  if (req.features.length) {
    const labels = req.features.map((f) => featureById(f.id)?.label.toLowerCase() ?? f.id);
    emit({ type: "progress", message: `Mapeando ${labels.join(", ")} e os bairros da cidade…` });
  }
  const pois: Record<string, Poi[]> = Object.fromEntries(await poisPromise);
  for (const f of req.features) {
    if (!pois[f.id]!.length)
      warn(`Nenhum(a) ${featureById(f.id)?.label ?? f.id} encontrado(a) no OpenStreetMap nessa área.`);
  }
  const places = await placesPromise.catch((e) => {
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
    fallback: net.fallback,
    hubs: net.hubs,
    flex: req.flex,
  });
  const regions = rankRegions(grid.cells, req.cellSizeM);
  const cellRouteIds = new Set(grid.cells.map((c) => c.routeId).filter((id): id is string => !!id));
  if (!grid.cellsMatching) {
    warn(
      grid.cells.length
        ? "Nenhuma área atende a tudo; mostrando as que chegam perto (um pouco mais longe ou com algum lugar mais distante)."
        : "Nenhuma região atende a tudo. Tente aumentar o tempo máximo ou os raios das características.",
    );
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
    // Só as linhas que chegam ao trabalho e as que as regiões encontradas usam (a rede inteira pesa MBs), mais os
    // trechos intermunicipais estimados até os terminais que as regiões usam.
    routes: [
      ...routes
        .filter((r) => net.keepIds.has(r.id) || cellRouteIds.has(r.id))
        .map(({ ptv2: _p, alightOnly: _a, ...r }) => r),
      ...net.legs(grid.hubsUsed),
    ],
    pois: trimmed,
    cells: grid.cells,
    regions,
    stats: {
      cellsTotal: grid.cellsTotal,
      cellsReachable: grid.cellsReachable,
      cellsMatching: grid.cellsMatching,
      cellsNear: grid.cells.length - grid.cellsMatching,
      stopsUsable: stops.length,
    },
    warnings,
  };
}
