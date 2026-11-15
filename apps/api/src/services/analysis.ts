import type { AnalysisResult, AnalyzeRequest, Emit, Poi } from "@homematch/contracts";
import { LEVEL_LABEL, inBBox, inMultiPolygon, padBBox, rankRegions, scoreGrid } from "@homematch/domain";
import { featureById, fetchFeaturePois, fetchPlaceNames } from "@homematch/sources";
import { intercityNetwork, localNetwork, osmArea } from "./commute.js";

/** Quantas das melhores regiões levam as linhas usadas ao mapa (as mesmas que a busca de imóveis percorre). */
const MAP_REGIONS = 15;

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
  // Sem tempo máximo, a cidade inteira entra: cada pedaço ganha um nível pelas prioridades da pessoa.
  const bbox = req.city.bbox;

  // Pelo limite do município: as bboxes de cidades vizinhas se sobrepõem.
  const workInCity = req.city.boundary?.length
    ? inMultiPolygon(req.work, req.city.boundary)
    : inBBox(req.work, req.city.bbox);
  // Lugares e bairros saem junto com as linhas (o Overpass é lento: melhor esperar uma vez só).
  const poisPromise = Promise.all(
    req.features.map(async (f) => {
      // Margem de 2× o raio: o lugar logo além da divisa também conta (e a consulta é a mesma de antes, no cache).
      return [f.id, await fetchFeaturePois(f.id, osmArea(req.city.bbox, f.radius * 2))] as const;
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
  // Linhas usadas pelas melhores regiões (as que entram na busca de imóveis); a cidade inteira pesaria MBs.
  const topNames = new Set(regions.slice(0, MAP_REGIONS).map((r) => r.name));
  const cellRouteIds = new Set(grid.cells.filter((c) => topNames.has(c.region) && c.routeId).map((c) => c.routeId!));
  const { excelente, boa, ok } = grid.levels;
  if (!grid.cells.length) {
    warn("Nenhuma região atinge o que você pediu. Aumente as distâncias dos lugares ou mude as prioridades.");
  } else if (!excelente && !boa) {
    warn(
      `Nenhuma região atinge a sua prioridade principal; mostrando as que atingem as outras (${LEVEL_LABEL.ok.toLowerCase()}).`,
    );
  }
  emit({
    type: "progress",
    message:
      `Áreas por nível: ${excelente} excelentes, ${boa} boas e ${ok} ok. ` +
      `Tempo até o trabalho: o melhor é ${grid.commuteBestMin} min; até ${grid.commuteRefMin} min conta como bem servido.`,
  });

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
      levels: grid.levels,
      commuteBestMin: grid.commuteBestMin,
      commuteRefMin: grid.commuteRefMin,
      stopsUsable: stops.length,
    },
    warnings,
  };
}
