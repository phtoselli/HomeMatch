import type { BBox } from "../../shared/types.js";
import { DAY, cached, httpFetch } from "../http.js";

// Servidores públicos do Overpass; tenta o próximo se um falhar.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
  members?: {
    type: "node" | "way" | "relation";
    ref: number;
    role: string;
    // presentes com `out geom`
    lat?: number;
    lon?: number;
    geometry?: ({ lat: number; lon: number } | null)[];
  }[];
}

export interface OverpassResponse {
  elements: OsmElement[];
  remark?: string;
}

export function bboxQL(b: BBox): string {
  return `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
}

/** Executa uma consulta Overpass QL (com cache em disco, 7 dias por padrão). */
export async function overpass(query: string, ttlMs = 7 * DAY): Promise<OverpassResponse> {
  return cached("overpass", query, ttlMs, async () => {
    const errors: string[] = [];
    for (const url of MIRRORS) {
      try {
        const res = await httpFetch(url, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          minIntervalMs: 1000,
          timeoutMs: 130_000,
          retries: 0, // servidor lotado: passa logo para o próximo espelho

        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const json = JSON.parse(text) as OverpassResponse;
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
          throw new Error(json.remark);
        }
        return json;
      } catch (e) {
        errors.push(`${new URL(url).host}: ${(e as Error).message}`);
      }
    }
    throw new Error(`Overpass indisponível. ${errors.join(" | ")}`);
  });
}

/** Coordenada de um elemento (nó ou centro de via/relação). */
export function elementPoint(e: OsmElement): { lat: number; lng: number } | null {
  if (e.lat != null && e.lon != null) return { lat: e.lat, lng: e.lon };
  if (e.center) return { lat: e.center.lat, lng: e.center.lon };
  return null;
}
