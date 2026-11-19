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

/** The search: what can be requested, good regions, listings in them and pasted links. */
export async function searchRoutes(app: FastifyInstance) {
  app.get("/features", async () => FEATURES);

  /** Portals + the city's agencies (added by the user, known, or in OpenStreetMap) and whether each can be read. */
  app.get("/sources", async (req) => {
    const { cityId, extra } = z
      .object({
        cityId: osmIdSchema.optional(),
        // Agency websites the user added (comma-separated); each one is still checked like any other site.
        extra: z.string().max(2000).optional(),
      })
      .parse(req.query);
    if (!cityId) return { city: "", portals: portalSources(), agencies: [] };
    const sites = (extra ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 10);
    return discoverSources(await getCity(cityId), (m) => req.log.info(m), sites);
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
