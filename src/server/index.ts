import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import type { AnalyzeRequest, LinkResult, LinksRequest, ListingsRequest, StreamEvent } from "../shared/types.js";
import { analyze } from "./analysis.js";
import { findBusLines } from "./busline.js";
import { operatorById, operatorFor } from "./operators/index.js";
import { resolveLink } from "./links.js";
import { FEATURES } from "./features.js";
import { SOURCES, searchListings } from "./listings/index.js";
import { getCity, reverse, searchAddress, searchCities } from "./osm/nominatim.js";

// API_PORT (não PORT): ferramentas de preview costumam definir PORT para o Vite.
const PORT = Number(process.env.API_PORT ?? 3333);
const app = Fastify({ logger: { level: "info" }, bodyLimit: 20 * 1024 * 1024 });

const bbox = z.object({ south: z.number(), west: z.number(), north: z.number(), east: z.number() });
const latLng = z.object({ lat: z.number(), lng: z.number() });

const analyzeSchema = z.object({
  city: z
    .object({ name: z.string(), bbox, boundary: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))).optional() })
    .passthrough(),
  work: latLng,
  features: z.array(z.object({ id: z.string(), radius: z.number().min(100).max(10_000) })),
  maxCommuteMin: z.number().min(5).max(180),
  maxWalkToStopM: z.number().min(100).max(2000),
  cellSizeM: z.number().min(200).max(2000),
  commuteWeight: z.number().min(0).max(1),
});

const listingsSchema = z.object({
  city: z.object({ name: z.string(), stateCode: z.string().optional(), bbox }),
  regions: z
    .array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lng: z.number(), bbox }))
    .min(1)
    .max(15),
  sources: z.array(z.enum(["quintoandar", "vivareal"])).min(1),
  maxPerRegion: z.number().min(10).max(300),
});

/** Resposta em NDJSON: uma linha JSON por evento (progresso, parciais, resultado). */
async function stream<T>(reply: FastifyReply, run: (emit: (ev: StreamEvent<T>) => void) => Promise<T>) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  const emit = (ev: StreamEvent<T>) => raw.write(JSON.stringify(ev) + "\n");
  try {
    const data = await run(emit);
    emit({ type: "result", data });
  } catch (e) {
    app.log.error(e);
    emit({ type: "error", message: (e as Error).message });
  } finally {
    raw.end();
  }
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/features", async () => FEATURES);

app.get("/api/sources", async () => Object.values(SOURCES).map((s) => ({ id: s.id, label: s.label })));

app.get("/api/cities", async (req) => {
  const { q } = z.object({ q: z.string().min(2) }).parse(req.query);
  return searchCities(q);
});

app.get("/api/city/:osmId", async (req) => {
  const { osmId } = z.object({ osmId: z.string().regex(/^[NWR]\d+$/) }).parse(req.params);
  return getCity(osmId);
});

app.get("/api/geocode", async (req) => {
  const q = z
    .object({
      q: z.string().min(3),
      south: z.coerce.number().optional(),
      west: z.coerce.number().optional(),
      north: z.coerce.number().optional(),
      east: z.coerce.number().optional(),
    })
    .parse(req.query);
  const box = q.south != null && q.west != null && q.north != null && q.east != null
    ? { south: q.south, west: q.west, north: q.north, east: q.east }
    : undefined;
  return searchAddress(q.q, box);
});

app.get("/api/reverse", async (req) => {
  const p = z.object({ lat: z.coerce.number(), lng: z.coerce.number() }).parse(req.query);
  return reverse(p);
});

app.post("/api/analyze", async (req, reply) => {
  const body = analyzeSchema.parse(req.body) as unknown as AnalyzeRequest;
  await stream(reply, (emit) => analyze(body, emit));
});

app.post("/api/listings", async (req, reply) => {
  const body = listingsSchema.parse(req.body) as ListingsRequest;
  await stream(reply, (emit) => searchListings(body, emit));
});

// ---------- Meus links ----------

const linksSchema = z.object({
  urls: z.array(z.string().min(8)).min(1).max(60),
  cityBBox: bbox.optional(),
});

app.post("/api/links", async (req, reply) => {
  const body = linksSchema.parse(req.body) as LinksRequest;
  await stream<LinkResult[]>(reply, async (emit) => {
    const results: LinkResult[] = [];
    for (const [i, url] of body.urls.entries()) {
      emit({ type: "progress", message: `Lendo link ${i + 1} de ${body.urls.length}…` });
      let r: LinkResult;
      try {
        r = { index: i + 1, url, listing: await resolveLink(url, body.cityBBox) };
      } catch (e) {
        r = { index: i + 1, url, error: (e as Error).message };
      }
      results.push(r);
      emit({ type: "partial", data: [r] });
    }
    return results;
  });
});

const cityQuery = {
  cityId: z.string().optional(),
  cityName: z.string().optional(),
  uf: z.string().optional(),
};
const cityOf = (q: { cityId?: string; cityName?: string; uf?: string }) =>
  q.cityName ? { osmId: q.cityId ?? "", name: q.cityName, stateCode: q.uf } : null;

/** Quem publica as linhas de ônibus da cidade (null = só OpenStreetMap). */
app.get("/api/transit/operator", async (req) => {
  const q = z.object(cityQuery).parse(req.query);
  return operatorFor(cityOf(q))?.info ?? null;
});

app.get("/api/bus", async (req) => {
  const q = z
    .object({
      q: z.string().min(1),
      south: z.coerce.number().optional(),
      west: z.coerce.number().optional(),
      north: z.coerce.number().optional(),
      east: z.coerce.number().optional(),
      ...cityQuery,
    })
    .parse(req.query);
  const box = q.south != null && q.west != null && q.north != null && q.east != null
    ? { south: q.south, west: q.west, north: q.north, east: q.east }
    : undefined;
  // Id salvo de uma linha do operador ("emdec:353:1").
  const byId = q.q.match(/^([a-z]+):(.+)$/);
  const saved = byId && operatorById(byId[1]!);
  if (saved) return saved.lineById(q.q);
  // Site oficial da cidade primeiro; sem resultado, OpenStreetMap.
  const op = /^https?:/i.test(q.q) ? undefined : operatorFor(cityOf(q));
  if (op) {
    const lines = await op.findLines(q.q);
    if (lines.length) return lines;
  }
  return findBusLines(q.q, box);
});

/** Linhas que passam perto de um ponto (o trabalho). */
app.get("/api/bus/near", async (req) => {
  const q = z
    .object({
      lat: z.coerce.number(),
      lng: z.coerce.number(),
      radius: z.coerce.number().min(100).max(2000).default(700),
      max: z.coerce.number().min(1).max(20).default(8),
      ...cityQuery,
    })
    .parse(req.query);
  const op = operatorFor(cityOf(q));
  if (!op) return [];
  return op.linesNear({ lat: q.lat, lng: q.lng }, q.radius, q.max);
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof z.ZodError) return reply.status(400).send({ error: "Parâmetros inválidos", issues: err.issues });
  app.log.error(err);
  return reply.status(502).send({ error: (err as Error).message ?? String(err) });
});

// Em produção (npm run build && npm start) o próprio servidor entrega o mapa.
const webDist = join(process.cwd(), "dist", "web");
if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist });

await app.listen({ port: PORT, host: "127.0.0.1" });
