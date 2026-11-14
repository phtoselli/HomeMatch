import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

/**
 * Entrada da API na Vercel (empacotada por scripts/build-vercel.mjs). O app React sai da CDN da Vercel;
 * esta função só atende /api/*. A instância do Fastify é montada uma vez e reaproveitada entre chamadas.
 */
const app = await buildApp({ ...loadEnv(), serveWeb: false });
await app.ready();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app.server.emit("request", req, res);
}
