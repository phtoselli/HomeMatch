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
import { cityAt, fetchBusStops, fetchIntercity, fetchRoutesNearWork, operatorFor } from "@homematch/sources";

/** Abaixo disso, consideramos que as linhas da cidade não estão bem mapeadas no OSM. */
const FEW_ROUTES = 8;
/** Com menos linhas intermunicipais mapeadas do que isso saindo da cidade, entra também a estimativa por terminal. */
const FEW_INTERCITY = 3;

/**
 * Área pedida ao OpenStreetMap: a cidade inteira com uma margem arredondada (5 km), e não o recorte em volta do
 * trabalho. Assim a mesma consulta serve para qualquer trabalho e tempo de trajeto e o cache acerta quase sempre.
 */
export const osmArea = (city: BBox, marginM: number) => padBBox(city, Math.ceil(Math.max(marginM, 1) / 5000) * 5000);

/** Como se chega ao trabalho: linhas, embarques com o tempo até lá e as estimativas para o que não está mapeado. */
export interface CommuteNetwork {
  routes: ParsedRoute[];
  stops: BoardingStop[];
  /** Linhas que param perto do trabalho (vão sempre ao mapa, primeiro na lista). */
  nearWorkIds: Set<string>;
  /** Linhas intermunicipais que saem da cidade de casa (vão sempre ao mapa, depois das de perto do trabalho). */
  intercityIds: Set<string>;
  fallback?: GridInput["fallback"];
  hubs?: Hub[];
  /** Trechos estimados (cidade → terminal) dos terminais que a grade usou, para desenhar no mapa. */
  legs(hubsUsed: string[]): TransitRoute[];
}

type Warn = (m: string) => void;

const noLegs = () => [];
const count = (routes: ParsedRoute[], ids: Set<string>) =>
  new Set(routes.filter((r) => ids.has(r.id)).map((r) => r.ref ?? r.id)).size;

/** Linhas que param perto do trabalho, da mais rápida para a mais lenta, e os números delas para a mensagem. */
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
  const list = refs.length ? `: ${refs.slice(0, 8).join(", ")}${refs.length > 8 ? "…" : ""}` : "";
  return { direct, ids, count: refs.length, list };
}

/** Rede do operador oficial da cidade (vazia se não houver ou se falhar). */
async function officialRoutes(city: City, emit: Emit, warn: Warn): Promise<{ routes: ParsedRoute[]; name?: string }> {
  const op = operatorFor(city);
  if (!op) return { routes: [] };
  emit({ type: "progress", message: `Baixando as linhas oficiais de ${op.info.name} (trajetos e pontos)…` });
  const routes = await op.routes().catch((e) => {
    warn(`Não deu para ler as linhas de ${op.info.name}: ${(e as Error).message}. Usando o OpenStreetMap.`);
    return [];
  });
  return { routes, name: op.info.name };
}

/** Trabalho na mesma cidade (ou cidade do trabalho desconhecida): rede da cidade e, se faltar, ônibus estimado. */
export async function localNetwork(
  req: AnalyzeRequest,
  emit: Emit,
  warn: Warn,
  workInCity = true,
): Promise<CommuteNetwork> {
  const op = await officialRoutes(req.city, emit, warn);
  let routes = op.routes;
  // Trabalho em outra cidade: as linhas municipais não chegam lá; vale o que o OSM tiver (intermunicipais).
  if (routes.length && !boardingStops(routes, req.work, DEFAULT_TRANSIT).length) routes = [];
  const official = routes.length > 0;
  // Com a rede oficial em mãos, não espera o Overpass (lento e muitas vezes lotado).
  if (!official) {
    emit({ type: "progress", message: "Buscando linhas de ônibus, metrô e trem que passam perto do trabalho…" });
    routes = await fetchRoutesNearWork(req.work, DEFAULT_TRANSIT).catch(() => {
      warn("O OpenStreetMap está lotado e não deu para buscar as linhas perto do trabalho agora.");
      return [];
    });
  }
  // Com a rede inteira do operador dá para considerar uma baldeação; com o OSM só há as linhas perto do trabalho.
  const transfers = official;
  const near = nearWork(routes, req.work);
  const directIds = near.ids;
  const stops = transfers ? boardingStops(routes, req.work, DEFAULT_TRANSIT, { transfers: true }) : near.direct;
  const nearCount = near.count;
  const viaCount = count(routes, new Set(stops.map((s) => s.routeId)));
  emit({
    type: "progress",
    message:
      `${nearCount} linhas passam perto do trabalho${official ? ` (fonte: ${op.name})` : ""}${near.list}` +
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
  return { routes, stops, nearWorkIds: directIds, intercityIds: new Set(), fallback, legs: noLegs };
}

const ESTIMATED_COLOR = "#495057";

/**
 * Trabalho em outra cidade. Procura as linhas intermunicipais entre as duas cidades (OpenStreetMap) e junta com a
 * rede da cidade do trabalho (operador oficial ou OSM) para a baldeação no destino. Se faltarem intermunicipais
 * mapeadas, estima o intermunicipal até um terminal da cidade do trabalho e segue dali pela rede municipal.
 */
export async function intercityNetwork(req: AnalyzeRequest, emit: Emit, warn: Warn): Promise<CommuteNetwork> {
  const home = req.city;
  const workCity = await cityAt(req.work).catch(() => null);
  if (!workCity || workCity.osmId === home.osmId) return localNetwork(req, emit, warn, !!workCity);

  const homeOp = operatorFor(home);
  const workOp = operatorFor(workCity);
  // As três buscas saem juntas (o Overpass é o mais lento), mas a tela recebe primeiro as linhas do trabalho.
  const interP = fetchIntercity(home, workCity).catch((e: Error) => e);
  const homeP: Promise<ParsedRoute[]> =
    homeOp && homeOp !== workOp
      ? // Rede da cidade de casa, se for de outro operador e chegar ao trabalho (cidades coladas).
        officialRoutes(home, emit, warn).then((r) =>
          boardingStops(r.routes, req.work, DEFAULT_TRANSIT).length ? r.routes : [],
        )
      : Promise.resolve([]);
  emit({
    type: "progress",
    message: `O trabalho fica em ${workCity.name}: primeiro, as linhas que passam perto dele…`,
  });
  // 1) Rede da cidade do trabalho: oficial quando há operador cadastrado; senão, as linhas do OSM perto do trabalho.
  const arrival = workOp
    ? (await officialRoutes(workCity, emit, warn)).routes
    : await fetchRoutesNearWork(req.work, DEFAULT_TRANSIT).catch(() => []);
  const near = nearWork(arrival, req.work);
  emit({
    type: "progress",
    message:
      `${near.count} linhas passam perto do trabalho em ${workCity.name}${workOp ? ` (${workOp.info.name})` : ""}` +
      `${near.list}. Agora, as linhas intermunicipais de ${home.name} para lá…`,
  });
  // 2) Linhas intermunicipais entre as duas cidades.
  const [inter, homeRoutes] = await Promise.all([interP, homeP]);

  // Overpass fora do ar: segue com o cálculo de antes (linhas perto do trabalho e ônibus estimado direto).
  if (inter instanceof Error) {
    warn(`Não deu para buscar as linhas intermunicipais no OpenStreetMap: ${inter.message}`);
    return localNetwork(req, emit, warn, false);
  }

  // A mesma linha pode vir do OSM como intermunicipal e como linha perto do trabalho: fica uma vez só.
  const routes = [...new Map([...arrival, ...homeRoutes, ...inter.routes].map((r) => [r.id, r])).values()];
  const stops = boardingStops(routes, req.work, DEFAULT_TRANSIT, { transfers: true });
  const atHome = (p: LatLng) => (home.boundary?.length ? inMultiPolygon(p, home.boundary) : inBBox(p, home.bbox));
  const homeIds = new Set(stops.filter(atHome).map((s) => s.routeId));
  const interIds = new Set(inter.routes.map((r) => r.id));
  const interHomeIds = new Set([...homeIds].filter((id) => interIds.has(id)));
  const interUsed = count(inter.routes, interHomeIds);
  emit({
    type: "progress",
    message:
      `${count(inter.routes, interIds)} linha(s) intermunicipal(is) mapeada(s) entre ${home.name} e ${workCity.name}` +
      (workOp ? `; em ${workCity.name}, baldeação pelas linhas de ${workOp.info.name}` : "") +
      ` — ${stops.filter(atHome).length} pontos de embarque em ${home.name}.`,
  });

  let fallback: GridInput["fallback"];
  let hubs: Hub[] = [];
  if (interUsed < FEW_INTERCITY) {
    hubs = hubsToWork(inter.stations, stops, req.work);
    const busStops = inter.homeStops;
    if (hubs.length && busStops.length) {
      fallback = { busStops, workStopDistM: 0, intercity: true };
      warn(
        (interUsed
          ? `Só ${interUsed} linha(s) intermunicipal(is) de ${home.name} para ${workCity.name} no OpenStreetMap. Para o resto, `
          : `Nenhuma linha intermunicipal de ${home.name} para ${workCity.name} está no OpenStreetMap. Por isso, `) +
          `o tempo é "intermunicipal (estimado)": ponto perto de casa → terminal de ${workCity.name} por rodovia ` +
          `(uns 6 km a 15 km/h e o resto a 40 km/h)` +
          (workOp ? ` → linha da ${workOp.info.name} até o trabalho. ` : ` → ônibus ou a pé até o trabalho. `) +
          `Confira a linha real no modo "Meus links".`,
      );
    } else if (busStops.length) {
      // Sem terminal útil na cidade do trabalho: ônibus estimado direto até perto do trabalho.
      const workStops = await fetchBusStops(bboxAround(req.work, 1500)).catch(() => []);
      const workStop = new PointIndex(workStops, 500, req.work.lat).nearest(req.work, DEFAULT_TRANSIT.busWalkAtWorkM);
      if (workStop) {
        fallback = { busStops, workStopDistM: workStop.dist, intercity: true };
        warn(
          `Nenhuma linha intermunicipal de ${home.name} para ${workCity.name} no OpenStreetMap. O tempo é ` +
            `"ônibus intermunicipal (estimado)": ponto perto de casa + ponto perto do trabalho, uns 6 km no ritmo ` +
            `da cidade e o resto por rodovia (40 km/h). Confira a linha real no modo "Meus links".`,
        );
      }
    }
    if (!fallback && !homeIds.size) {
      warn(`Nenhuma linha nem ponto de ônibus no OpenStreetMap ligando ${home.name} a ${workCity.name}.`);
    }
  }

  // Onde o trecho estimado começa no mapa: o ponto de ônibus mais perto do centro da cidade.
  const origin =
    new PointIndex(inter.homeStops, 500, home.lat).nearest(home, 3000)?.item ??
    ({ lat: home.lat, lng: home.lng } as LatLng);
  const legs = (used: string[]): TransitRoute[] =>
    hubs
      .filter((h) => used.includes(h.id))
      .map((h) => ({
        id: `intercity-est-${h.id}`,
        name: `Intermunicipal (estimado): ${home.name} → ${h.name}`,
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
    // Ao mapa vão as que passam perto do trabalho e as intermunicipais; da rede da cidade do trabalho, só as que as
    // regiões usam (a rede inteira passa de cem linhas).
    nearWorkIds: new Set([...near.ids, ...nearWork(homeRoutes, req.work).ids]),
    intercityIds: interHomeIds,
    fallback,
    hubs,
    legs,
  };
}
