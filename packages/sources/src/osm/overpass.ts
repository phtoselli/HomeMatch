import type { BBox } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { DAY, cached, httpFetch } from "../http.js";

// Public Overpass servers; the next one is tried when one fails. overpass-api.de has two machines (lz4 and z) with
// their own queues: when the main address says "at capacity", one of them usually has room.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** At capacity or briefly down (worth retrying shortly). */
const BUSY = /HTTP (429|502|503|504)|at capacity|Too Many Requests|timed out|abort/i;
/** Second round over the servers only if the first one failed fast (all busy), after this pause. */
const RETRY = { withinMs: 45_000, pauseMs: 4_000 };

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
    // present with `out geom`
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

/** Runs an Overpass QL query (disk-cached, 7 days by default). */
export async function overpass(query: string, ttlMs = 7 * DAY): Promise<OverpassResponse> {
  return cached("overpass", query, ttlMs, async () => {
    const started = Date.now();
    try {
      return await tryMirrors(query);
    } catch (e) {
      // All busy at once: wait a bit and try another round (the Overpass queue moves fast).
      if (!BUSY.test((e as Error).message) || Date.now() - started > RETRY.withinMs) throw e;
      await new Promise((r) => setTimeout(r, RETRY.pauseMs));
      return tryMirrors(query);
    }
  });
}

/** One round over the servers: the first to answer wins. */
async function tryMirrors(query: string): Promise<OverpassResponse> {
  const errors: string[] = [];
  for (const url of MIRRORS) {
    try {
      const res = await httpFetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        minIntervalMs: 1000,
        timeoutMs: 130_000,
        retries: 0, // busy server: move on to the next mirror right away
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${brief(text)}`);
      const json = JSON.parse(text) as OverpassResponse;
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
        throw new Error(json.remark);
      }
      return json;
    } catch (e) {
      errors.push(`${new URL(url).host}: ${(e as Error).message}`);
    }
  }
  throw new Error(t.sources.overpassUnavailable(errors.join(" | ")));
}

/** Short, readable error (a busy server returns a whole HTML page). */
const brief = (text: string) =>
  text
    .replace(/<[^>]+>/g, " ")
    .replace(/s+/g, " ")
    .trim()
    .slice(0, 90);

/** Coordinates of an element (node, or center of a way/relation). */
export function elementPoint(e: OsmElement): { lat: number; lng: number } | null {
  if (e.lat != null && e.lon != null) return { lat: e.lat, lng: e.lon };
  if (e.center) return { lat: e.center.lat, lng: e.center.lon };
  return null;
}
