import type { BBox, LatLng, TransitMode } from "@homematch/contracts";
import { DEFAULT_TRANSIT, MODES, distance, type ParsedRoute, type TransitParams } from "@homematch/domain";
import { bboxQL, elementPoint, overpass, type OsmElement } from "./osm/overpass.js";
import { t } from "@homematch/i18n";

const ROUTE_RE = "^(bus|trolleybus|minibus|share_taxi|subway|train|light_rail|tram|monorail)$";

export function buildTransitQuery(work: LatLng, p: TransitParams = DEFAULT_TRANSIT): string {
  const { lat, lng } = work;
  const b = p.busWalkAtWorkM;
  const r = p.railWalkAtWorkM;
  return `[out:json][timeout:180];
(
  node(around:${b},${lat},${lng})["highway"="bus_stop"];
  node(around:${b},${lat},${lng})["public_transport"="platform"];
  node(around:${r},${lat},${lng})["public_transport"="stop_position"];
  node(around:${r},${lat},${lng})["railway"~"^(station|halt|stop|tram_stop)$"];
)->.near;
(
  way(around:${r},${lat},${lng})["public_transport"="platform"];
  way(around:${r},${lat},${lng})["railway"="platform"];
)->.nearw;
(
  rel(bn.near)["type"="route"]["route"~"${ROUTE_RE}"];
  rel(bw.nearw)["type"="route"]["route"~"${ROUTE_RE}"];
)->.routes;
.routes out body;
node(r.routes);
out skel qt;
(
  way(r.routes:"platform");
  way(r.routes:"platform_entry_only");
  way(r.routes:"platform_exit_only");
);
out center qt;`;
}

function normalizeMode(route: string): TransitMode {
  if (route === "minibus" || route === "share_taxi") return "bus";
  return (route in MODES ? route : "bus") as TransitMode;
}

/** Builds lines from the Overpass response: stops in order, without consecutive duplicates. */
export function parseRoutes(elements: OsmElement[]): ParsedRoute[] {
  const nodes = new Map<number, LatLng>();
  const ways = new Map<number, LatLng>();
  for (const e of elements) {
    const p = elementPoint(e);
    if (!p) continue;
    if (e.type === "node") nodes.set(e.id, p);
    else if (e.type === "way") ways.set(e.id, p);
  }
  const out: ParsedRoute[] = [];
  for (const rel of elements) {
    if (rel.type !== "relation" || !rel.members) continue;
    const tags = rel.tags ?? {};
    const path: [number, number][] = [];
    for (const m of rel.members) {
      let p: LatLng | undefined;
      if (m.type === "node") p = nodes.get(m.ref);
      else if (m.type === "way" && m.role.startsWith("platform")) p = ways.get(m.ref);
      if (!p) continue;
      const last = path[path.length - 1];
      // stop position and platform usually come in pairs: merge points that are very close
      if (last && distance({ lat: last[0], lng: last[1] }, p) < 80) continue;
      path.push([p.lat, p.lng]);
    }
    if (path.length < 2) continue;
    const mode = normalizeMode(tags.route ?? "bus");
    out.push({
      id: String(rel.id),
      ref: tags.ref,
      name: tags.name || [tags.ref, tags.to].filter(Boolean).join(" → ") || t.transit.lineName(String(rel.id)),
      mode,
      color: /^#[0-9a-f]{3,6}$/i.test(tags.colour ?? "") ? tags.colour! : MODES[mode].color,
      operator: tags.operator ?? tags.network,
      path,
      ptv2: tags["public_transport:version"] === "2",
    });
  }
  return out;
}

export async function fetchBusStops(bbox: BBox): Promise<LatLng[]> {
  const q = `[out:json][timeout:180];(node["highway"="bus_stop"](${bboxQL(bbox)});node["public_transport"="platform"]["bus"="yes"](${bboxQL(bbox)}););out skel qt;`;
  const res = await overpass(q);
  return res.elements.filter((e) => e.lat != null).map((e) => ({ lat: e.lat!, lng: e.lon! }));
}

export async function fetchRoutesNearWork(work: LatLng, p: TransitParams = DEFAULT_TRANSIT): Promise<ParsedRoute[]> {
  const res = await overpass(buildTransitQuery(work, p));
  return parseRoutes(res.elements);
}
