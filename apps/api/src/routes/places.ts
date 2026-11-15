import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { osmIdSchema } from "@homematch/contracts";
import { getCity, reverse, searchAddress, searchCities } from "@homematch/sources";
import { bboxFrom, bboxQuery, latQuery, lngQuery } from "./query.js";

/** Cidades e endereços (Nominatim, com cache e no máximo 1 req/s). */
export async function placesRoutes(app: FastifyInstance) {
  app.get("/cities", async (req) => {
    const { q } = z.object({ q: z.string().min(2).max(120) }).parse(req.query);
    return searchCities(q);
  });

  app.get("/city/:osmId", async (req) => {
    const { osmId } = z.object({ osmId: osmIdSchema }).parse(req.params);
    return getCity(osmId);
  });

  app.get("/geocode", async (req) => {
    const q = z.object({ q: z.string().min(3).max(300), ...bboxQuery }).parse(req.query);
    return searchAddress(q.q, bboxFrom(q));
  });

  app.get("/reverse", async (req) => {
    const p = z.object({ lat: latQuery, lng: lngQuery }).parse(req.query);
    return reverse(p);
  });
}
