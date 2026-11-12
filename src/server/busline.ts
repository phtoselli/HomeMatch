import type { BBox, BusLine, TransitMode } from "../shared/types.js";
import { distance } from "./geo.js";
import { DAY } from "./http.js";
import { bboxQL, overpass, type OsmElement } from "./osm/overpass.js";
import { MODES } from "./transit.js";

/**
 * Acha uma linha de transporte no OpenStreetMap e devolve o traçado exato (vias da relação).
 * Aceita: número da linha ("875A-10", "609F", "Linha 4"), link do OSM (…/relation/123),
 * link do itinerário da SPTrans (…?cdp=170211, guardado na tag `website` da linha no OSM)
 * ou outro link que contenha o número da linha (Moovit etc.).
 */
export type BusQuery =
  | { kind: "osm"; id: string }
  | { kind: "website"; pattern: string; refs: string[] }
  | { kind: "ref"; refs: string[]; text: string };

const ROUTE_RE = "^(bus|trolleybus|minibus|share_taxi|subway|train|light_rail|tram|monorail)$";

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");

/** Candidatos a número de linha dentro de um texto/URL ("875A-10", "6450", "N137"). */
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
    const pattern = cdp ? `cdp=${cdp}($|&)` : escRe(`${u.host.replace(/^www\./, "")}${u.pathname}`.replace(/\/$/, ""));
    return { kind: "website", pattern, refs: refCandidates(decodeURIComponent(u.pathname + " " + u.search)) };
  }
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
    // sem resultado pelo link, o número da linha extraído do link entra como alternativa
    sel += q.refs.map((r) => `${base}["ref"~"^${escRe(r)}(-[0-9]+)?$",i]${bb};`).join("");
  } else {
    sel = q.refs.map((r) => `${base}["ref"~"^${escRe(r)}(-[0-9]+)?$",i]${bb};`).join("");
    if (q.text.length >= 4) sel += `${base}["name"~"${escRe(q.text)}",i]${bb};`;
  }
  return `[out:json][timeout:120];(${sel})->.r;.r out geom;node(r.r)->.n;.n out body qt;`;
}

function mode(route: string | undefined): TransitMode {
  if (route === "minibus" || route === "share_taxi" || !route) return "bus";
  return (route in MODES ? route : "bus") as TransitMode;
}

/** Parse puro da resposta (relações com `out geom` + nós com tags). */
export function parseBusLines(elements: OsmElement[], q?: BusQuery): BusLine[] {
  const nodeNames = new Map<number, string>();
  for (const e of elements) if (e.type === "node" && e.tags?.name) nodeNames.set(e.id, e.tags.name);

  let rels = elements.filter((e) => e.type === "relation" && e.members);
  // Link de site: se algum casou pela tag website/url, ignora os que vieram só pelo número.
  if (q?.kind === "website") {
    const re = new RegExp(q.pattern, "i");
    const byLink = rels.filter((r) => re.test(r.tags?.website ?? "") || re.test(r.tags?.url ?? ""));
    if (byLink.length) rels = byLink;
  }
  // Número exato primeiro (875A-10 antes de 875A-11 quando o pedido foi 875A-10).
  const wanted = q && "refs" in q ? q.refs : [];
  rels.sort((a, b) => Number(!wanted.includes(a.tags?.ref?.toUpperCase() ?? "")) - Number(!wanted.includes(b.tags?.ref?.toUpperCase() ?? "")));

  const out: BusLine[] = [];
  for (const r of rels.slice(0, 8)) {
    const t = r.tags ?? {};
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
        const pts = m.geometry.filter((p): p is { lat: number; lon: number } => !!p).map((p) => [p.lat, p.lon] as [number, number]);
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
    const md = mode(t.route);
    out.push({
      id: String(r.id),
      ref: t.ref,
      name: t.name || [t.ref, t.to].filter(Boolean).join(" → ") || `Linha ${r.id}`,
      from: t.from,
      to: t.to,
      mode: md,
      color: /^#[0-9a-f]{3,6}$/i.test(t.colour ?? "") ? t.colour! : MODES[md].color,
      operator: t.operator ?? t.network,
      website: t.website ?? t.url,
      // sem vias mapeadas, liga as paradas em ordem
      segments: segments.length ? segments : [stops.map((s) => [s.lat, s.lng] as [number, number])],
      stops,
    });
  }
  return out;
}

export async function findBusLines(raw: string, bbox?: BBox): Promise<BusLine[]> {
  const q = parseBusQuery(raw);
  if (q.kind !== "osm" && !bbox) throw new Error("Escolha a cidade antes (a busca pelo número da linha é feita dentro dela).");
  const res = await overpass(buildBusQuery(q, bbox), 3 * DAY);
  return parseBusLines(res.elements, q);
}
