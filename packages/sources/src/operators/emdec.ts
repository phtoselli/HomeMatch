import type { BusLine, LatLng, LineTimetable } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { distance } from "@homematch/domain";
import { DAY, HttpError, cached, httpFetch } from "../http.js";
import type { ParsedRoute } from "@homematch/domain";
import type { TransitOperator } from "./types.js";

// EMDEC (Campinas/SP). The public itinerary portal draws its map from two GeoJSON layers (every line and every
// stop, in order), and the line lookup has names, companies and destinations. Field names below (num_linha,
// sentido…) are the operator's own and must stay as published.
const BASE = "https://portal.emdec.com.br";
export const EMDEC_URLS = {
  lines: `${BASE}/itinerarios/js/lin_itinerarios.js`,
  stops: `${BASE}/itinerarios/js/pto_itinerarios_pontos.js`,
  search: `${BASE}/consultalinha/consulta_linha.php`,
  detail: `${BASE}/consultalinha/detalhe_linha.php`,
  map: (ref: string, dir: number) => `${BASE}/itinerarios/?linha=${encodeURIComponent(ref)}&sentido=${dir}`,
};

// ---------- Pure parsing ----------

interface Feature<P, G> {
  properties: P;
  geometry: G | null;
}
interface FeatureCollection<P, G> {
  features: Feature<P, G>[];
}

/** The layers come as `var geoJSONLinItinerarios = { ...GeoJSON... };`. */
export function parseGeoJsonVar<P, G>(js: string): FeatureCollection<P, G> {
  const start = js.indexOf("{");
  const end = js.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("EMDEC GeoJSON layer in an unexpected format");
  return JSON.parse(js.slice(start, end + 1)) as FeatureCollection<P, G>;
}

export interface EmdecStop extends LatLng {
  id: number;
  seq: number;
  street: string;
  number?: string;
  /** "Embarque" (boarding) or "Desembarque" (alighting only), as published. */
  use?: string;
  /** Lines that stop here (e.g. ["350", "353", "358"]). */
  lines: string[];
}

export interface EmdecDirection {
  ref: string;
  direction: number;
  lengthM?: number;
  segments: [number, number][][]; // [lat, lng]
  stops: EmdecStop[];
}

type LineProps = { num_linha: string; sentido: number; extensao_m?: number };
type LineGeom = { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
type StopProps = {
  num_linha: string;
  sentido: number;
  ponto_id: number;
  ptseqlinha: number;
  ende_logradouro?: string | null;
  ende_numero?: string | number | null;
  tipo_uso?: string | null;
  linhas?: string | null;
};
type StopGeom = { type: "Point"; coordinates: [number, number] };

const key = (ref: string, dir: number) => `${ref}|${dir}`;

/** Joins shapes and stops per line + direction; stops in travel order. */
export function parseEmdecNetwork(linesJs: string, stopsJs: string): EmdecDirection[] {
  const byKey = new Map<string, EmdecDirection>();
  const get = (ref: string, dir: number) => {
    let d = byKey.get(key(ref, dir));
    if (!d) byKey.set(key(ref, dir), (d = { ref, direction: dir, segments: [], stops: [] }));
    return d;
  };

  for (const f of parseGeoJsonVar<LineProps, LineGeom>(linesJs).features) {
    const g = f.geometry;
    if (!g || !f.properties?.num_linha) continue;
    const d = get(String(f.properties.num_linha).trim(), Number(f.properties.sentido));
    d.lengthM = f.properties.extensao_m;
    const parts = (g.type === "LineString" ? [g.coordinates] : g.coordinates) as number[][][];
    for (const part of parts) {
      const pts = part.map(([lng, lat]) => [lat!, lng!] as [number, number]);
      if (pts.length > 1) d.segments.push(pts);
    }
  }

  for (const f of parseGeoJsonVar<StopProps, StopGeom>(stopsJs).features) {
    const p = f.properties;
    const g = f.geometry;
    if (!g || !p?.num_linha) continue;
    const d = get(String(p.num_linha).trim(), Number(p.sentido));
    d.stops.push({
      id: p.ponto_id,
      seq: Number(p.ptseqlinha),
      lat: g.coordinates[1],
      lng: g.coordinates[0],
      street: (p.ende_logradouro ?? "").trim(),
      number: p.ende_numero != null && String(p.ende_numero).trim() ? String(p.ende_numero).trim() : undefined,
      use: p.tipo_uso ?? undefined,
      // "350,353,358 [07/11/2026]" → ["350", "353", "358"]
      lines: (p.linhas ?? "")
        .replace(/\[.*?\]/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  const out = [...byKey.values()].filter((d) => d.segments.length || d.stops.length > 1);
  for (const d of out) d.stops.sort((a, b) => a.seq - b.seq);
  return out.sort((a, b) => a.ref.localeCompare(b.ref, "pt-BR", { numeric: true }) || a.direction - b.direction);
}

export interface EmdecLineInfo {
  ref: string; // "353", "126.1"
  code: string; // internal code used by the detail page ("353283D")
  name: string;
  company?: string;
}

/** Line search response (the portal's autocomplete). */
export function parseEmdecSearch(json: unknown): EmdecLineInfo[] {
  if (!Array.isArray(json)) return [];
  const out: EmdecLineInfo[] = [];
  for (const row of json as { text?: string }[]) {
    try {
      const t = JSON.parse(row.text ?? "") as {
        linha?: string;
        linhaosletra?: string;
        nome?: string;
        empresa?: string;
      };
      if (!t.linha || !t.linhaosletra) continue;
      out.push({
        ref: t.linha.trim(),
        code: t.linhaosletra,
        name: (t.nome ?? "").trim(),
        company: t.empresa?.trim() || undefined,
      });
    } catch {
      // malformed row: skip
    }
  }
  return out;
}

export interface EmdecLineDetail {
  name?: string;
  company?: string;
  /** Per direction: where it starts and the headsign (destination). */
  directions: Record<number, { from?: string; to?: string }>;
}

const clean = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Line detail page (HTML returned by detalhe_linha.php). */
export function parseEmdecDetail(html: string): EmdecLineDetail {
  const field = (label: string) =>
    html.match(new RegExp(`<small>${label}</small></div>\\s*<div[^>]*>([^<]*)<`, "i"))?.[1];
  const directions: EmdecLineDetail["directions"] = {};
  for (const d of [1, 2]) {
    const to = field(`Sentido ${d}`);
    if (to) directions[d] = { to: clean(to) };
  }
  const re = /Horários de partida de\s*<span[^>]*>([^<]+)<\/span>[\s\S]*?Indicação Frontal:\s*<span[^>]*>([^<]+)</g;
  let i = 1;
  for (const m of html.matchAll(re)) {
    directions[i] = { from: clean(m[1]!), to: directions[i]?.to ?? clean(m[2]!) };
    i++;
  }
  const name = field("Nome");
  const company = field("Empresa/consórcio/cooperativa");
  return { name: name ? clean(name) : undefined, company: company ? clean(company) : undefined, directions };
}

/**
 * Timetable from the detail page: one "Horários de partida de <stop>" block per direction, with "Dias úteis",
 * "Sábados", "Domingos/Feriados" and the times (sometimes with a legend letter). The patterns match the page text.
 */
export function parseEmdecTimetable(html: string, ref: string): LineTimetable {
  const info = parseEmdecDetail(html);
  const heads = [...html.matchAll(/id="headingHorarioPartida(\d+)"/g)];
  const obsAt = html.indexOf('id="headingObservacao"');
  const directions: LineTimetable["directions"] = heads.map((m, i) => {
    const end = heads[i + 1]?.index ?? (obsAt > m.index! ? obsAt : html.length);
    const sec = html.slice(m.index, end);
    const days: { label: string; times: string[] }[] = [];
    for (const t of sec.matchAll(
      /col-12 text-center font-weight-bold[^"]*">([^<]+)<|<small>\s*(\d{1,2}:\d{2}[^<]*)<\/small>/g,
    )) {
      if (t[1]) days.push({ label: clean(t[1]), times: [] });
      else if (t[2] && days.length) days[days.length - 1]!.times.push(clean(t[2]));
    }
    const direction = Number(m[1]);
    return {
      direction,
      from:
        clean(sec.match(/Horários de partida de\s*<span[^>]*>([^<]+)</)?.[1] ?? "") || info.directions[direction]?.from,
      to: clean(sec.match(/Indicação Frontal:\s*<span[^>]*>([^<]+)</)?.[1] ?? "") || info.directions[direction]?.to,
      days: days.filter((d) => d.times.length),
    };
  });
  const obs = html.match(/id="collapseObservacao"[\s\S]*?<div class="col-12">([\s\S]*?)<\/div>/)?.[1];
  const note = obs ? clean(obs.replace(/<[^>]+>/g, " ")) : "";
  return {
    ref,
    name: info.name,
    operator: info.company ? `EMDEC · ${info.company}` : "EMDEC",
    directions,
    note: note || undefined,
    updated: html.match(/Atualizado em ([^<]+)</)?.[1]?.trim(),
  };
}

/** "126,1" / "linha 353" → "126.1" / "353" (users type the line the Brazilian way). */
export function normalizeRef(q: string): string {
  return q
    .trim()
    .replace(/^linha\s+/i, "")
    .replace(",", ".")
    .toUpperCase();
}

const PALETTE = [
  "#e8590c",
  "#1971c2",
  "#2f9e44",
  "#c2255c",
  "#7048e8",
  "#0c8599",
  "#d9480f",
  "#5c940d",
  "#862e9c",
  "#364fc7",
];
function colorFor(ref: string): string {
  let h = 0;
  for (const ch of ref) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function toBusLine(
  d: EmdecDirection,
  info?: { name?: string; company?: string; detail?: EmdecLineDetail },
): BusLine {
  const dir = info?.detail?.directions[d.direction];
  const stopName = (s: EmdecStop) =>
    [s.street, s.number].filter(Boolean).join(", ") + (s.use === "Desembarque" ? ` ${t.transit.alightOnlyStop}` : "");
  return {
    id: `emdec:${d.ref}:${d.direction}`,
    ref: d.ref,
    name: info?.name || t.transit.lineName(d.ref),
    from: dir?.from ?? d.stops[0]?.street,
    to: dir?.to ?? d.stops.at(-1)?.street,
    mode: "bus",
    color: colorFor(d.ref),
    operator: info?.company ? `EMDEC · ${info.company}` : "EMDEC",
    website: EMDEC_URLS.map(d.ref, d.direction),
    segments: d.segments.length ? d.segments : [d.stops.map((s) => [s.lat, s.lng] as [number, number])],
    stops: d.stops.map((s) => ({ lat: s.lat, lng: s.lng, name: stopName(s) })),
    source: "emdec",
    direction: d.direction,
  };
}

/** Drops nearly collinear/close points (the shape is sent to the browser on every analysis). */
export function simplify(line: [number, number][], minM = 15): [number, number][] {
  if (line.length <= 2) return line;
  const out: [number, number][] = [line[0]!];
  for (let i = 1; i < line.length - 1; i++) {
    const [lat, lng] = line[i]!;
    const [plat, plng] = out[out.length - 1]!;
    if (distance({ lat, lng }, { lat: plat, lng: plng }) >= minM) out.push(line[i]!);
  }
  out.push(line[line.length - 1]!);
  return out;
}

// ---------- Network (cached download) ----------

async function getText(url: string, init?: { method: string; body: URLSearchParams }): Promise<string> {
  const cacheKey = init ? `${url}?${init.body}` : url;
  return cached("emdec", cacheKey, DAY, async () => {
    const res = await httpFetch(url, {
      ...init,
      headers: init ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      minIntervalMs: 500,
      timeoutMs: 120_000,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 200));
    return text;
  });
}

let memo: { at: number; data: Promise<EmdecDirection[]> } | null = null;

/** Full network (≈14 MB the first time; then served from the disk cache for 1 day). */
export function emdecNetwork(): Promise<EmdecDirection[]> {
  if (!memo || Date.now() - memo.at > DAY) {
    const data = Promise.all([getText(EMDEC_URLS.lines), getText(EMDEC_URLS.stops)]).then(([l, s]) =>
      parseEmdecNetwork(l, s),
    );
    memo = { at: Date.now(), data };
    data.catch(() => (memo = null));
  }
  return memo.data;
}

async function searchLines(q: string): Promise<EmdecLineInfo[]> {
  const text = await getText(EMDEC_URLS.search, { method: "POST", body: new URLSearchParams({ term: q }) });
  return parseEmdecSearch(JSON.parse(text));
}

async function lineInfo(ref: string): Promise<{ name?: string; company?: string; detail?: EmdecLineDetail }> {
  try {
    const found = (await searchLines(ref)).find((l) => l.ref === ref);
    if (!found) return {};
    const html = await getText(EMDEC_URLS.detail, { method: "POST", body: new URLSearchParams({ term: found.code }) });
    return { name: found.name, company: found.company, detail: parseEmdecDetail(html) };
  } catch {
    return {}; // name/destination are cosmetic: the line still shows without them
  }
}

/** Line detail page (name, company, destinations and timetable). */
async function detailHtml(ref: string): Promise<string | null> {
  const found = (await searchLines(ref)).find((l) => l.ref === ref);
  if (!found) return null;
  return getText(EMDEC_URLS.detail, { method: "POST", body: new URLSearchParams({ term: found.code }) });
}

async function linesFor(refs: string[]): Promise<BusLine[]> {
  const net = await emdecNetwork();
  const out: BusLine[] = [];
  for (const ref of refs) {
    const dirs = net.filter((d) => d.ref === ref);
    if (!dirs.length) continue;
    const info = await lineInfo(ref);
    out.push(...dirs.map((d) => toBusLine(d, info)));
  }
  return out;
}

export const emdec: TransitOperator = {
  info: {
    id: "emdec",
    name: "EMDEC",
    site: "https://portal.emdec.com.br/consultalinha/",
    provides: t.transit.emdecProvides,
  },

  serves: (c) => c.osmId === "R298227" || (/^campinas$/i.test(c.name.trim()) && (c.stateCode ?? "SP") === "SP"),

  async findLines(q) {
    const ref = normalizeRef(q);
    const net = await emdecNetwork();
    if (net.some((d) => d.ref === ref)) return linesFor([ref]);
    // By name ("Alphaville") or partial number: use the portal's search.
    const hits = (await searchLines(q.trim()).catch(() => [])).map((h) => h.ref);
    return linesFor([...new Set(hits)].slice(0, 4));
  },

  async lineById(id) {
    const [, ref, dir] = id.split(":");
    if (!ref) return [];
    return (await linesFor([ref])).filter((l) => !dir || String(l.direction) === dir);
  },

  async linesNear(p, radiusM, maxLines) {
    const net = await emdecNetwork();
    const best = new Map<string, number>(); // ref → shortest distance
    const perDir = new Map<string, number>();
    for (const d of net) {
      let min = Infinity;
      for (const s of d.stops) min = Math.min(min, distance(p, s));
      perDir.set(key(d.ref, d.direction), min);
      if (min <= radiusM) best.set(d.ref, Math.min(best.get(d.ref) ?? Infinity, min));
    }
    const refs = [...best.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, maxLines)
      .map(([r]) => r);
    const lines = await linesFor(refs);
    return lines.map((l) => ({ ...l, nearWorkM: Math.round(perDir.get(key(l.ref!, l.direction!)) ?? Infinity) }));
  },

  async timetable(ref) {
    const r = normalizeRef(ref);
    const html = await detailHtml(r);
    if (!html) return null;
    return { ...parseEmdecTimetable(html, r), source: "https://portal.emdec.com.br/consultalinha/" };
  },

  async routes(): Promise<ParsedRoute[]> {
    const net = await emdecNetwork();
    return net
      .filter((d) => d.stops.length > 1)
      .map((d) => ({
        id: `emdec:${d.ref}:${d.direction}`,
        ref: d.ref,
        name: `Linha ${d.ref}`,
        mode: "bus" as const,
        color: colorFor(d.ref),
        operator: "EMDEC",
        path: d.stops.map((s) => [s.lat, s.lng] as [number, number]),
        alightOnly: d.stops.map((s) => s.use === "Desembarque"),
        shape: d.segments.map(simplify),
        ptv2: true, // each direction is separate: do not reverse
      }));
  },
};
