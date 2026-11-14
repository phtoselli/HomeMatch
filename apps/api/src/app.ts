import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { Env } from "./env.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { placesRoutes } from "./routes/places.js";
import { searchRoutes } from "./routes/search.js";
import { transitRoutes } from "./routes/transit.js";

/**
 * Monta a API sem abrir a porta: o main.ts escuta, os testes usam `app.inject`.
 * Rotas em /api (o app chama sempre pelo mesmo caminho, no Vite e em produção).
 */
export async function buildApp(env: Pick<Env, "LOG_LEVEL" | "serveWeb" | "WEB_DIST">) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL }, bodyLimit: 20 * 1024 * 1024 });
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

  // Uso local (npm run app): o próprio servidor entrega o mapa já montado.
  if (env.serveWeb) await app.register(fastifyStatic, { root: env.WEB_DIST });
  return app;
}
