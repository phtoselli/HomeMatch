import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { timetableIdSchema } from "@homematch/contracts";
import { findBusLines, findBusLinesNear, operatorById, operatorFor } from "@homematch/sources";
import { HttpProblem } from "../plugins/errors.js";
import { bboxFrom, bboxQuery, cityFrom, cityQuery } from "./query.js";

/** Linhas de ônibus: operador da cidade (ex.: EMDEC) primeiro, OpenStreetMap como reserva. */
export async function transitRoutes(app: FastifyInstance) {
  /** Quem publica as linhas de ônibus da cidade (null = só OpenStreetMap). */
  app.get("/transit/operator", async (req) => {
    const q = z.object(cityQuery).parse(req.query);
    return operatorFor(cityFrom(q))?.info ?? null;
  });

  app.get("/bus", async (req) => {
    const q = z.object({ q: z.string().min(1), ...bboxQuery, ...cityQuery }).parse(req.query);
    // Id salvo de uma linha do operador ("emdec:353:1").
    const byId = q.q.match(/^([a-z]+):(.+)$/);
    const saved = byId && operatorById(byId[1]!);
    if (saved) return saved.lineById(q.q);
    // Site oficial da cidade primeiro; sem resultado, OpenStreetMap.
    const op = /^https?:/i.test(q.q) ? undefined : operatorFor(cityFrom(q));
    if (op) {
      const lines = await op.findLines(q.q);
      if (lines.length) return lines;
    }
    return findBusLines(q.q, bboxFrom(q));
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
        lat: z.coerce.number(),
        lng: z.coerce.number(),
        radius: z.coerce.number().min(100).max(2000).default(700),
        max: z.coerce.number().min(1).max(20).default(8),
        ...cityQuery,
      })
      .parse(req.query);
    const op = operatorFor(cityFrom(q));
    // Sem operador cadastrado, as linhas do OpenStreetMap que param perto.
    if (!op) return findBusLinesNear({ lat: q.lat, lng: q.lng }, q.radius, q.max);
    return op.linesNear({ lat: q.lat, lng: q.lng }, q.radius, q.max);
  });
}
