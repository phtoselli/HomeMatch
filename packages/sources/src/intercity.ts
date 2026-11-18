import type { BBox, LatLng, Polygon } from "@homematch/contracts";
import { inBBox, inMultiPolygon, type ParsedRoute } from "@homematch/domain";
import { parseBusLines } from "./busline.js";
import { DAY } from "./http.js";
import { bboxQL, elementPoint, overpass, type OsmElement } from "./osm/overpass.js";
import { t } from "@homematch/i18n";

/**
 * Work in another city: intercity lines from OpenStreetMap (the ones stopping in both cities), the bus stops of the
 * city where the user wants to live and the terminals of the work city. All in a single query, because the public
 * Overpass servers are often at capacity.
 */

const ROUTE_RE = "^(bus|trolleybus|minibus|share_taxi|train|light_rail|subway|monorail)$";

/** A city: bbox for the query and, when available, the boundary to check what is inside. */
export interface CityArea {
  bbox: BBox;
  boundary?: Polygon[];
}

/** Bus terminal or station: where intercity buses usually arrive. */
export interface BusStation extends LatLng {
  name: string;
}

export interface IntercityData {
  /** Lines stopping in both cities (one item per OSM relation; PTv1 counts both ways). */
  routes: ParsedRoute[];
  /** Bus stops of the home city. */
  homeStops: LatLng[];
  /** Terminals and bus stations of the work city. */
  stations: BusStation[];
}

const stopsIn = (b: BBox) =>
  `node(${bboxQL(b)})["highway"="bus_stop"];node(${bboxQL(b)})["public_transport"~"^(platform|stop_position)$"];`;

export function buildIntercityQuery(home: BBox, work: BBox): string {
  const w = bboxQL(work);
  return (
    `[out:json][timeout:180];` +
    `(${stopsIn(home)})->.sa;rel(bn.sa)["type"="route"]["route"~"${ROUTE_RE}"]->.ra;` +
    // Of the lines stopping in the home city, those that also run through the work city (a bbox filter on the
    // relation: much lighter than finding every stop of a big city). Whether they really stop there is checked
    // while parsing.
    `rel.ra(${w})->.r;.r out geom;` +
    `.sa out skel qt;` +
    `(nwr["amenity"="bus_station"](${w});nwr["public_transport"="station"]["bus"="yes"](${w}););out center tags qt;`
  );
}

const inside = (p: LatLng, a: CityArea) => (a.boundary?.length ? inMultiPolygon(p, a.boundary) : inBBox(p, a.bbox));

/** Pure parsing of the `buildIntercityQuery` response. */
export function parseIntercity(elements: OsmElement[], home: CityArea, work: CityArea): IntercityData {
  const rels = elements.filter((e) => e.type === "relation" && e.members);
  const ptv2 = new Map(rels.map((r) => [String(r.id), r.tags?.["public_transport:version"] === "2"]));
  const routes: ParsedRoute[] = [];
  for (const l of parseBusLines(rels, undefined, Infinity)) {
    // Neighboring cities' bboxes overlap: use the boundary to check that the line really stops in both.
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
    const tags = e.tags;
    if (!tags) {
      if (e.lat != null && e.lon != null) homeStops.push({ lat: e.lat, lng: e.lon });
      continue;
    }
    const p = elementPoint(e);
    if (!p || !inside(p, work)) continue;
    const name = tags.name ?? (tags.amenity === "bus_station" ? t.transit.busTerminal : t.transit.busStation);
    // A station mapped both as a point and as an area: keep one.
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
