import type { IncomingMessage, ServerResponse } from "node:http";
import { getCache } from "@vercel/functions";
import { useSharedCache } from "@homematch/sources";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

/**
 * API entry point on Vercel (bundled by scripts/build-vercel.mjs). The React app is served by Vercel's CDN; this
 * function only handles /api/*. The Fastify instance is built once and reused across invocations.
 */

// /tmp belongs to each instance: the Runtime Cache keeps OSM, addresses and bus networks for the next ones.
if (process.env.VERCEL) useSharedCache(getCache({ namespace: "homematch" }));

const app = await buildApp({ ...loadEnv(), serveWeb: false });
await app.ready();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app.server.emit("request", req, res);
}
