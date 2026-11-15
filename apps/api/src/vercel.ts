import type { IncomingMessage, ServerResponse } from "node:http";
import { getCache } from "@vercel/functions";
import { useSharedCache } from "@homematch/sources";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

/**
 * Entrada da API na Vercel (empacotada por scripts/build-vercel.mjs). O app React sai da CDN da Vercel;
 * esta função só atende /api/*. A instância do Fastify é montada uma vez e reaproveitada entre chamadas.
 */

// O /tmp é de cada instância: o Runtime Cache guarda OSM, endereços e rede de ônibus para as próximas.
if (process.env.VERCEL) useSharedCache(getCache({ namespace: "homematch" }));

const app = await buildApp({ ...loadEnv(), serveWeb: false });
await app.ready();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app.server.emit("request", req, res);
}
