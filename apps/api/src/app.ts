import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { Env } from "./env.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { placesRoutes } from "./routes/places.js";
import { searchRoutes } from "./routes/search.js";
import { transitRoutes } from "./routes/transit.js";

/**
 * Builds the API without opening a port: main.ts listens, tests use `app.inject`.
 * Routes live under /api (the app always calls the same path, in Vite and in production).
 */
export async function buildApp(env: Pick<Env, "LOG_LEVEL" | "serveWeb" | "WEB_DIST">) {
  // 2 MB easily fits the boundary of the largest city (São Paulo is ~150 KB) and rejects absurd bodies.
  const app = Fastify({ logger: { level: env.LOG_LEVEL }, bodyLimit: 2 * 1024 * 1024 });
  registerErrorHandler(app);

  await app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      await api.register(placesRoutes);
      await api.register(searchRoutes);
      await api.register(transitRoutes);
    },
    { prefix: "/api" },
  );

  // Local use (npm run app): the server itself serves the built app.
  if (env.serveWeb) await app.register(fastifyStatic, { root: env.WEB_DIST });
  return app;
}
