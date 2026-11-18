import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { timetableIdSchema, type BBox, type CityRef, type LatLng } from "@homematch/contracts";
import { padBBox } from "@homematch/domain";
import { t } from "@homematch/i18n";
import {
  cityAt,
  findBusLines,
  findBusLinesNear,
  operatorById,
  operatorFor,
  type TransitOperator,
} from "@homematch/sources";
import { HttpProblem } from "../plugins/errors.js";
import { bboxFrom, bboxQuery, cityFrom, cityQuery, latQuery, lngQuery } from "./query.js";

/** Work location (optional) in the query string: when it is in another city, that city's operator is used too. */
const workQuery = { wlat: latQuery.optional(), wlng: lngQuery.optional() };
const workFrom = (q: { wlat?: number; wlng?: number }): LatLng | undefined =>
  q.wlat != null && q.wlng != null ? { lat: q.wlat, lng: q.wlng } : undefined;

/** Operators of the home city and of the work city (no repeats). Living in Paulínia: Campinas' EMDEC. */
async function operatorsFor(city: CityRef | null, work?: LatLng): Promise<TransitOperator[]> {
  const home = operatorFor(city);
  const workCity = work ? await cityAt(work).catch(() => null) : null;
  const atWork = workCity ? operatorFor(workCity) : undefined;
  return [...new Set([home, atWork].filter((o): o is TransitOperator => !!o))];
}

/** OpenStreetMap search area: the city and, when work is outside it, the work location too (with margin). */
function searchArea(box: BBox | undefined, work?: LatLng): BBox | undefined {
  if (!box || !work) return box;
  const w = padBBox({ south: work.lat, north: work.lat, west: work.lng, east: work.lng }, 3000);
  return {
    south: Math.min(box.south, w.south),
    north: Math.max(box.north, w.north),
    west: Math.min(box.west, w.west),
    east: Math.max(box.east, w.east),
  };
}

/** Bus lines: the city's operator (e.g. EMDEC) first, OpenStreetMap as fallback. */
export async function transitRoutes(app: FastifyInstance) {
  /** Who publishes the city's bus lines (null = OpenStreetMap only). */
  app.get("/transit/operator", async (req) => {
    const q = z.object({ ...cityQuery, ...workQuery }).parse(req.query);
    return (await operatorsFor(cityFrom(q), workFrom(q)))[0]?.info ?? null;
  });

  app.get("/bus", async (req) => {
    const q = z.object({ q: z.string().min(1).max(500), ...bboxQuery, ...cityQuery, ...workQuery }).parse(req.query);
    // Saved id of an operator line ("emdec:353:1").
    const byId = q.q.match(/^([a-z]+):(.+)$/);
    const saved = byId && operatorById(byId[1]!);
    if (saved) return saved.lineById(q.q);
    // Official sites of the home and work cities first; without results, OpenStreetMap (covering both).
    const work = workFrom(q);
    if (!/^https?:/i.test(q.q)) {
      for (const op of await operatorsFor(cityFrom(q), work)) {
        const lines = await op.findLines(q.q);
        if (lines.length) return lines;
      }
    }
    return findBusLines(q.q, searchArea(bboxFrom(q), work));
  });

  /** Timetable of an operator line ("emdec:353" or "emdec:353:1"). */
  app.get("/bus/timetable", async (req) => {
    const { id } = z.object({ id: timetableIdSchema }).parse(req.query);
    const [opId, ref] = id.split(":") as [string, string];
    const op = operatorById(opId);
    if (!op?.timetable) throw new HttpProblem(404, t.api.noTimetable);
    const timetable = await op.timetable(ref);
    if (!timetable) throw new HttpProblem(404, t.api.lineNotFound(ref));
    return timetable;
  });

  /** Lines passing near a point (work). */
  app.get("/bus/near", async (req) => {
    const q = z
      .object({
        lat: latQuery,
        lng: lngQuery,
        radius: z.coerce.number().min(100).max(2000).default(700),
        max: z.coerce.number().min(1).max(20).default(8),
        ...cityQuery,
      })
      .parse(req.query);
    // The operator is the one of the point's city (work may be in a neighboring city), otherwise the home city's.
    const point = { lat: q.lat, lng: q.lng };
    const [op] = await operatorsFor(null, point).then(async (ops) => (ops.length ? ops : operatorsFor(cityFrom(q))));
    // Without a registered operator, the OpenStreetMap lines that stop nearby.
    if (!op) return findBusLinesNear(point, q.radius, q.max);
    return op.linesNear({ lat: q.lat, lng: q.lng }, q.radius, q.max);
  });
}
