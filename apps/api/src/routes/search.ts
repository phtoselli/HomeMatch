import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyzeRequestSchema,
  linksRequestSchema,
  listingsRequestSchema,
  osmIdSchema,
  type LinkResult,
} from "@homematch/contracts";
import { FEATURES, discoverSources, getCity, portalSources, searchListings } from "@homematch/sources";
import { stream } from "../plugins/stream.js";
import { analyze } from "../services/analysis.js";
import { resolveLinks } from "../services/links.js";

/** A busca: o que dá para pedir, regiões boas, imóveis nelas e links colados. */
export async function searchRoutes(app: FastifyInstance) {
  app.get("/features", async () => FEATURES);

  /** Portais + imobiliárias da cidade (descobertas no OpenStreetMap) e se dá para ler cada uma. */
  app.get("/sources", async (req) => {
    const { cityId } = z.object({ cityId: osmIdSchema.optional() }).parse(req.query);
    if (!cityId) return { city: "", portals: portalSources(), agencies: [] };
    return discoverSources(await getCity(cityId), (m) => req.log.info(m));
  });

  app.post("/analyze", async (req, reply) => {
    const body = analyzeRequestSchema.parse(req.body);
    await stream(reply, (emit) => analyze(body, emit));
  });

  app.post("/listings", async (req, reply) => {
    const body = listingsRequestSchema.parse(req.body);
    await stream(reply, (emit) => searchListings(body, emit));
  });

  app.post("/links", async (req, reply) => {
    const body = linksRequestSchema.parse(req.body);
    await stream<LinkResult[]>(reply, (emit) => resolveLinks(body, emit));
  });
}
