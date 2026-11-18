import type { BBox, BusLine, LatLng, TransitMode } from "@homematch/contracts";
import { distance } from "@homematch/domain";
import { DAY } from "./http.js";
import { bboxQL, overpass, type OsmElement } from "./osm/overpass.js";
import { MODES } from "@homematch/domain";
import { t } from "@homematch/i18n";

/**
 * Finds a transit line in OpenStreetMap and returns its exact geometry (the relation's ways).
 * Accepts: line number ("875A-10", "609F", "Linha 4"), OSM link (…/relation/123), SPTrans itinerary link
 * (…?cdp=170211, stored in the line's `website` tag in OSM) or any other link containing the line number (Moovit…).
 */
export type BusQuery =
  | { kind: "osm"; id: string }
  | { kind: "website"; pattern: string; refs: string[] }
  | { kind: "ref"; refs: string[]; text: string };

const ROUTE_RE = "^(bus|trolleybus|minibus|share_taxi|subway|train|light_rail|tram|monorail)$";

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");

/** Line number candidates inside a text/URL ("875A-10", "6450", "N137"). */
export function refCandidates(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.toUpperCase().matchAll(/\b([A-Z]?\d{2,4}[A-Z]?(?:-\d{1,2})?)\b/g)) out.add(m[1]!);
  return [...out];
}

export function parseBusQuery(raw: string): BusQuery {
  const q = raw.trim();
  const osm = q.match(/openstreetmap\.org\/relation\/(\d+)/i);
  if (osm) return { kind: "osm", id: osm[1]! };
  if (/^https?:\/\//i.test(q)) {
    const u = new URL(q);
    const cdp = u.searchParams.get("cdp");
    const pattern = cdp
      ? `cdp=${escRe(cdp)}($|&)`
      : escRe(`${u.host.replace(/^www\./, "")}${u.pathname}`.replace(/\/$/, ""));
    return { kind: "website", pattern, refs: refCandidates(decodeURIComponent(u.pathname + " " + u.search)) };
  }
  // Users type "linha 353" / "ônibus 353" (Portuguese) or "bus 353".
  const text = q.replace(/^(linha|ônibus|onibus|bus)\s+/i, "").trim();
  return { kind: "ref", refs: refCandidates(text).length ? refCandidates(text) : [text.toUpperCase()], text };
}

export function buildBusQuery(q: BusQuery, bbox?: BBox): string {
  const bb = bbox ? `(${bboxQL(bbox)})` : "";
  const base = `rel["type"="route"]["route"~"${ROUTE_RE}"]`;
  let sel: string;
  if (q.kind === "osm") sel = `rel(${q.id});`;
  else if (q.kind === "website") {
    sel = `${base}["website"~"${q.pattern}",i]${bb};${base}["url"~"${q.pattern}",i]${bb};`;
    // when the link finds nothing, the line number extracted from it is the fallback
    sel += q.refs.map((r) => `${base}["ref"~"^${escRe(r)}(-[0-9]+)?$",i]${bb};`).join("");
  } else {
    sel = q.refs.map((r) => `${base}["ref"~"^${escRe(r)}(-[0-9]+)?$",i]${bb};`).join("");
    if (q.text.length >= 4) sel += `${base}["name"~"${escRe(q.text)}",i]${bb};`;
    // Lines without a ref tag, with the number only in the name ("Linha 353 ESTAÇÃO …")
    else if (/^[0-9]{2,4}[A-Z]?$/i.test(q.text))
      sel += `${base}["name"~"(^|[^0-9])${escRe(q.text)}([^0-9]|$)",i]${bb};`;
  }
  return `[out:json][timeout:120];(${sel})->.r;.r out geom;node(r.r)->.n;.n out body qt;`;
}

function mode(route: string | undefined): TransitMode {
  if (route === "minibus" || route === "share_taxi" || !route) return "bus";
  return (route in MODES ? route : "bus") as TransitMode;
}

/** Pure parsing of the response (relations with `out geom` + tagged nodes). */
export function parseBusLines(elements: OsmElement[], q?: BusQuery, max = 8): BusLine[] {
  const nodeNames = new Map<number, string>();
  for (const e of elements) if (e.type === "node" && e.tags?.name) nodeNames.set(e.id, e.tags.name);

  let rels = elements.filter((e) => e.type === "relation" && e.members);
  // Website link: if any relation matched by its website/url tag, ignore those that matched only by number.
  if (q?.kind === "website") {
    const re = new RegExp(q.pattern, "i");
    const byLink = rels.filter((r) => re.test(r.tags?.website ?? "") || re.test(r.tags?.url ?? ""));
    if (byLink.length) rels = byLink;
  }
  // Exact number first (875A-10 before 875A-11 when 875A-10 was requested).
  const wanted = q && "refs" in q ? q.refs : [];
  rels.sort(
    (a, b) =>
      Number(!wanted.includes(a.tags?.ref?.toUpperCase() ?? "")) -
      Number(!wanted.includes(b.tags?.ref?.toUpperCase() ?? "")),
  );

  const out: BusLine[] = [];
  for (const r of rels.slice(0, max)) {
    const tags = r.tags ?? {};
    const segments: [number, number][][] = [];
    const stops: BusLine["stops"] = [];
    const pushStop = (lat: number, lng: number, name?: string) => {
      const last = stops[stops.length - 1];
      if (last && distance(last, { lat, lng }) < 40) {
        last.name ??= name;
        return;
      }
      stops.push({ lat, lng, name });
    };
    for (const m of r.members!) {
      const isStop = /^(stop|platform)/.test(m.role);
      if (m.type === "way" && m.geometry) {
        const pts = m.geometry
          .filter((p): p is { lat: number; lon: number } => !!p)
          .map((p) => [p.lat, p.lon] as [number, number]);
        if (!pts.length) continue;
        if (isStop) {
          const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
          const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          pushStop(lat, lng);
        } else segments.push(pts);
      } else if (m.type === "node" && m.lat != null && m.lon != null && (isStop || m.role === "")) {
        pushStop(m.lat, m.lon, nodeNames.get(m.ref));
      }
    }
    if (!segments.length && stops.length < 2) continue;
    const md = mode(tags.route);
    out.push({
      id: String(r.id),
      ref: tags.ref,
      name: tags.name || [tags.ref, tags.to].filter(Boolean).join(" → ") || t.transit.lineName(String(r.id)),
      from: tags.from,
      to: tags.to,
      mode: md,
      color: /^#[0-9a-f]{3,6}$/i.test(tags.colour ?? "") ? tags.colour! : MODES[md].color,
      operator: tags.operator ?? tags.network,
      website: tags.website ?? tags.url,
      // without mapped ways, connect the stops in order
      segments: segments.length ? segments : [stops.map((s) => [s.lat, s.lng] as [number, number])],
      stops,
    });
  }
  return out;
}

export async function findBusLines(raw: string, bbox?: BBox): Promise<BusLine[]> {
  const q = parseBusQuery(raw);
  if (q.kind !== "osm" && !bbox) throw new Error(t.transit.chooseCityFirst);
  const res = await overpass(buildBusQuery(q, bbox), 3 * DAY);
  return parseBusLines(res.elements, q);
}

/** OSM lines with a stop within `radiusM` of the point (cities without a registered operator). */
export function buildNearQuery(p: LatLng, radiusM: number): string {
  const around = `around:${Math.round(radiusM)},${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  return (
    `[out:json][timeout:120];(node(${around})["highway"="bus_stop"];node(${around})["public_transport"~"^(platform|stop_position)$"];)->.s;` +
    `rel(bn.s)["type"="route"]["route"~"${ROUTE_RE}"]->.r;.r out geom;node(r.r)->.n;.n out body qt;`
  );
}

export async function findBusLinesNear(p: LatLng, radiusM: number, maxLines: number): Promise<BusLine[]> {
  const res = await overpass(buildNearQuery(p, radiusM), 3 * DAY);
  // Each direction is a relation: up to 2 per line.
  const lines = parseBusLines(res.elements, undefined, maxLines * 2).map((l) => ({
    ...l,
    source: "osm",
    nearWorkM: Math.round(Math.min(...l.stops.map((s) => distance(p, s)), Infinity)),
  }));
  return lines.sort((a, b) => (a.nearWorkM ?? Infinity) - (b.nearWorkM ?? Infinity));
}
