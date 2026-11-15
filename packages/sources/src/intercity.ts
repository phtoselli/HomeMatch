import type { BBox, LatLng, Polygon } from "@homematch/contracts";
import { inBBox, inMultiPolygon, type ParsedRoute } from "@homematch/domain";
import { parseBusLines } from "./busline.js";
import { DAY } from "./http.js";
import { bboxQL, elementPoint, overpass, type OsmElement } from "./osm/overpass.js";

/**
 * Trabalho em outra cidade: linhas intermunicipais do OpenStreetMap (as que param nas duas cidades), os pontos de
 * ônibus da cidade onde a pessoa quer morar e os terminais da cidade do trabalho. Tudo numa consulta só, porque o
 * Overpass público vive lotado.
 */

const ROUTE_RE = "^(bus|trolleybus|minibus|share_taxi|train|light_rail|subway|monorail)$";

/** Uma cidade: bbox para a consulta e, se houver, o limite para conferir quem está dentro. */
export interface CityArea {
  bbox: BBox;
  boundary?: Polygon[];
}

/** Terminal, rodoviária ou estação de ônibus: onde o intermunicipal costuma chegar. */
export interface BusStation extends LatLng {
  name: string;
}

export interface IntercityData {
  /** Linhas com parada nas duas cidades (um item por relação do OSM; PTv1 vale nos dois sentidos). */
  routes: ParsedRoute[];
  /** Pontos de ônibus da cidade de casa. */
  homeStops: LatLng[];
  /** Terminais e rodoviárias da cidade do trabalho. */
  stations: BusStation[];
}

const stopsIn = (b: BBox) =>
  `node(${bboxQL(b)})["highway"="bus_stop"];node(${bboxQL(b)})["public_transport"~"^(platform|stop_position)$"];`;

export function buildIntercityQuery(home: BBox, work: BBox): string {
  const w = bboxQL(work);
  return (
    `[out:json][timeout:180];` +
    `(${stopsIn(home)})->.sa;rel(bn.sa)["type"="route"]["route"~"${ROUTE_RE}"]->.ra;` +
    `(${stopsIn(work)})->.sb;rel(bn.sb)["type"="route"]["route"~"${ROUTE_RE}"]->.rb;` +
    // Interseção: as linhas que param nas duas áreas.
    `rel.ra.rb->.r;.r out geom;` +
    `.sa out skel qt;` +
    `(nwr["amenity"="bus_station"](${w});nwr["public_transport"="station"]["bus"="yes"](${w}););out center tags qt;`
  );
}

const inside = (p: LatLng, a: CityArea) => (a.boundary?.length ? inMultiPolygon(p, a.boundary) : inBBox(p, a.bbox));

/** Parse puro da resposta de `buildIntercityQuery`. */
export function parseIntercity(elements: OsmElement[], home: CityArea, work: CityArea): IntercityData {
  const rels = elements.filter((e) => e.type === "relation" && e.members);
  const ptv2 = new Map(rels.map((r) => [String(r.id), r.tags?.["public_transport:version"] === "2"]));
  const routes: ParsedRoute[] = [];
  for (const l of parseBusLines(rels, undefined, Infinity)) {
    // As bboxes de cidades vizinhas se sobrepõem: confere pelo limite que a linha para mesmo nas duas.
    if (l.stops.length < 2 || !l.stops.some((s) => inside(s, home)) || !l.stops.some((s) => inside(s, work))) continue;
    routes.push({
      id: l.id,
      ref: l.ref,
      name: l.name,
      mode: l.mode,
      color: l.color,
      operator: l.operator,
      path: l.stops.map((s) => [s.lat, s.lng]),
      shape: l.segments,
      ptv2: ptv2.get(l.id) ?? false,
    });
  }

  const homeStops: LatLng[] = [];
  const stations: BusStation[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    if (e.type === "relation") continue;
    const t = e.tags;
    if (!t) {
      if (e.lat != null && e.lon != null) homeStops.push({ lat: e.lat, lng: e.lon });
      continue;
    }
    const p = elementPoint(e);
    if (!p || !inside(p, work)) continue;
    const name = t.name ?? (t.amenity === "bus_station" ? "Terminal de ônibus" : "Estação de ônibus");
    // Estação mapeada como ponto e como área: fica uma só.
    const key = `${name}|${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stations.push({ ...p, name });
  }
  return { routes, homeStops, stations };
}

export async function fetchIntercity(home: CityArea, work: CityArea): Promise<IntercityData> {
  const res = await overpass(buildIntercityQuery(home.bbox, work.bbox), 3 * DAY);
  return parseIntercity(res.elements, home, work);
}
