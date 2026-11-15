import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { timetableIdSchema, type BBox, type CityRef, type LatLng } from "@homematch/contracts";
import { padBBox } from "@homematch/domain";
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

/** Trabalho (opcional) na query string: se fica em outra cidade, o operador de lá também entra. */
const workQuery = { wlat: latQuery.optional(), wlng: lngQuery.optional() };
const workFrom = (q: { wlat?: number; wlng?: number }): LatLng | undefined =>
  q.wlat != null && q.wlng != null ? { lat: q.wlat, lng: q.wlng } : undefined;

/** Operador da cidade de casa e o da cidade do trabalho (sem repetir). Morando em Paulínia: a EMDEC de Campinas. */
async function operatorsFor(city: CityRef | null, work?: LatLng): Promise<TransitOperator[]> {
  const home = operatorFor(city);
  const workCity = work ? await cityAt(work).catch(() => null) : null;
  const atWork = workCity ? operatorFor(workCity) : undefined;
  return [...new Set([home, atWork].filter((o): o is TransitOperator => !!o))];
}

/** Área da busca no OpenStreetMap: a cidade e, se o trabalho fica fora dela, o trabalho também (com folga). */
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

/** Linhas de ônibus: operador da cidade (ex.: EMDEC) primeiro, OpenStreetMap como reserva. */
export async function transitRoutes(app: FastifyInstance) {
  /** Quem publica as linhas de ônibus da cidade (null = só OpenStreetMap). */
  app.get("/transit/operator", async (req) => {
    const q = z.object({ ...cityQuery, ...workQuery }).parse(req.query);
    return (await operatorsFor(cityFrom(q), workFrom(q)))[0]?.info ?? null;
  });

  app.get("/bus", async (req) => {
    const q = z.object({ q: z.string().min(1).max(500), ...bboxQuery, ...cityQuery, ...workQuery }).parse(req.query);
    // Id salvo de uma linha do operador ("emdec:353:1").
    const byId = q.q.match(/^([a-z]+):(.+)$/);
    const saved = byId && operatorById(byId[1]!);
    if (saved) return saved.lineById(q.q);
    // Site oficial da cidade de casa e da cidade do trabalho primeiro; sem resultado, OpenStreetMap (nas duas).
    const work = workFrom(q);
    if (!/^https?:/i.test(q.q)) {
      for (const op of await operatorsFor(cityFrom(q), work)) {
        const lines = await op.findLines(q.q);
        if (lines.length) return lines;
      }
    }
    return findBusLines(q.q, searchArea(bboxFrom(q), work));
  });

  /** Grade de horários de uma linha do operador ("emdec:353" ou "emdec:353:1"). */
  app.get("/bus/timetable", async (req) => {
    const { id } = z.object({ id: timetableIdSchema }).parse(req.query);
    const [opId, ref] = id.split(":") as [string, string];
    const op = operatorById(opId);
    if (!op?.timetable) throw new HttpProblem(404, "Essa linha não tem grade de horários publicada pelo operador.");
    const t = await op.timetable(ref);
    if (!t) throw new HttpProblem(404, `Linha ${ref} não encontrada no site do operador.`);
    return t;
  });

  /** Linhas que passam perto de um ponto (o trabalho). */
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
    // O operador é o da cidade onde fica o ponto (o trabalho pode ser na cidade vizinha), senão o da cidade de casa.
    const point = { lat: q.lat, lng: q.lng };
    const [op] = await operatorsFor(null, point).then(async (ops) => (ops.length ? ops : operatorsFor(cityFrom(q))));
    // Sem operador cadastrado, as linhas do OpenStreetMap que param perto.
    if (!op) return findBusLinesNear(point, q.radius, q.max);
    return op.linesNear({ lat: q.lat, lng: q.lng }, q.radius, q.max);
  });
}
