import type { AnalysisResult, AnalyzeRequest, Emit, Poi } from "@homematch/contracts";
import {
  DEFAULT_TRANSIT,
  FLEX,
  PointIndex,
  analysisBBox,
  bboxAround,
  boardingStops,
  inBBox,
  commuteLimit,
  padBBox,
  rankRegions,
  scoreGrid,
  type GridInput,
  type ParsedRoute,
} from "@homematch/domain";
import type { BBox } from "@homematch/contracts";
import {
  featureById,
  fetchBusStops,
  fetchFeaturePois,
  fetchPlaceNames,
  fetchRoutesNearWork,
  operatorFor,
} from "@homematch/sources";

/** Abaixo disso, consideramos que as linhas da cidade não estão bem mapeadas no OSM. */
const FEW_ROUTES = 8;

/**
 * Área pedida ao OpenStreetMap: a cidade inteira com uma margem arredondada (5 km), e não o recorte em volta do
 * trabalho. Assim a mesma consulta serve para qualquer trabalho e tempo de trajeto e o cache acerta quase sempre.
 */
const osmArea = (city: BBox, marginM: number) => padBBox(city, Math.ceil(Math.max(marginM, 1) / 5000) * 5000);

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

  const workInCity = inBBox(req.work, req.city.bbox);
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

  const op = operatorFor(req.city);
  let routes: ParsedRoute[] = [];
  if (op) {
    emit({ type: "progress", message: `Baixando as linhas oficiais de ${op.info.name} (trajetos e pontos)…` });
    routes = await op.routes().catch((e) => {
      warn(`Não deu para ler as linhas de ${op.info.name}: ${(e as Error).message}. Usando o OpenStreetMap.`);
      return [];
    });
    // Trabalho em outra cidade: as linhas municipais não chegam lá; vale o que o OSM tiver (intermunicipais).
    if (routes.length && !boardingStops(routes, req.work, DEFAULT_TRANSIT).length) routes = [];
  }
  const official = routes.length > 0;
  // Com a rede oficial em mãos, não espera o Overpass (lento e muitas vezes lotado).
  if (!official) {
    emit({ type: "progress", message: "Buscando linhas de ônibus, metrô e trem que passam perto do trabalho…" });
    routes = await fetchRoutesNearWork(req.work, DEFAULT_TRANSIT);
  }
  // Com a rede inteira do operador dá para considerar uma baldeação; com o OSM só há as linhas perto do trabalho.
  const transfers = official;
  const direct = boardingStops(routes, req.work, DEFAULT_TRANSIT);
  const stops = transfers ? boardingStops(routes, req.work, DEFAULT_TRANSIT, { transfers: true }) : direct;
  const usedIds = new Set(stops.map((s) => s.routeId));
  const directIds = new Set(direct.map((s) => s.routeId));
  const nearCount = new Set(routes.filter((r) => directIds.has(r.id)).map((r) => r.ref ?? r.id)).size;
  const viaCount = new Set(routes.filter((r) => usedIds.has(r.id)).map((r) => r.ref ?? r.id)).size;
  emit({
    type: "progress",
    message:
      `${nearCount} linhas passam perto do trabalho${official ? ` (fonte: ${op!.info.name})` : ""}` +
      (transfers ? `; com uma baldeação, ${viaCount} linhas levam até lá` : "") +
      ` — ${stops.length} pontos de embarque.`,
  });
  let fallback: GridInput["fallback"];
  if (nearCount < FEW_ROUTES && !(official && nearCount > 0)) {
    emit({
      type: "progress",
      message: "Poucas linhas mapeadas no OpenStreetMap aqui; buscando os pontos de ônibus da cidade…",
    });
    // Pontos da cidade e, se o trabalho fica em outra cidade, os de perto dele.
    const [cityStops, workStops] = await Promise.all([
      fetchBusStops(osmArea(req.city.bbox, 1000)).catch(() => []),
      workInCity ? [] : fetchBusStops(bboxAround(req.work, 1500)).catch(() => []),
    ]);
    const busStops = [...cityStops, ...workStops];
    const workStop = new PointIndex(busStops, 500, req.work.lat).nearest(req.work, DEFAULT_TRANSIT.busWalkAtWorkM);
    if (workStop) {
      fallback = { busStops, workStopDistM: workStop.dist, intercity: !workInCity };
      warn(
        `Só ${nearCount} linha(s) com itinerário no OpenStreetMap perto do trabalho. Para o resto, o tempo é ` +
          (workInCity
            ? `"ônibus (estimado)": ponto perto de casa + ponto perto do trabalho, em linha quase reta a 15 km/h. `
            : `"ônibus intermunicipal (estimado)": ponto perto de casa + ponto perto do trabalho, uns 6 km no ritmo ` +
              `da cidade (15 km/h) e o resto por rodovia (40 km/h). `) +
          `Confira a linha real no modo "Meus links".`,
      );
    } else if (!nearCount) {
      warn("Nenhuma linha nem ponto de ônibus no OpenStreetMap perto do trabalho; só a caminhada foi considerada.");
    }
  }

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
    fallback,
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
      cellsMatching: grid.cellsMatching,
      cellsNear: grid.cells.length - grid.cellsMatching,
      stopsUsable: stops.length,
    },
    warnings,
  };
}
