/**
 * Cloudflare Worker for home-match.pedrotoselli.com.
 *
 * Static files (the React app in apps/web/dist) are served by Workers static assets before this code runs, at no CPU
 * cost. Only /api/* reaches the Worker (wrangler.jsonc → `run_worker_first`), and it is forwarded as is to the API
 * deployment (API_ORIGIN). Bodies are streamed in both directions, so the NDJSON progress of long searches arrives
 * as it happens and the Worker uses almost no CPU (fits the free plan).
 */

interface Env {
  /** Origin of the API deployment, e.g. https://home-match-delta.vercel.app */
  API_ORIGIN: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Hop-by-hop or Cloudflare-specific request headers that must not be forwarded. */
const DROP_REQUEST_HEADERS = ["host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-real-ip"];

export function apiRequest(request: Request, apiOrigin: string): Request {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, apiOrigin);
  const headers = new Headers(request.headers);
  for (const h of DROP_REQUEST_HEADERS) headers.delete(h);
  headers.set("x-forwarded-host", url.host);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    // Streams the body instead of buffering it (required by Node's fetch, accepted by Workers).
    duplex: "half",
  } as RequestInit);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      try {
        const res = await fetch(apiRequest(request, env.API_ORIGIN));
        // Re-wrap so headers are mutable and the body keeps streaming.
        const out = new Response(res.body, res);
        out.headers.set("cache-control", out.headers.get("cache-control") ?? "no-store");
        return out;
      } catch {
        return Response.json({ error: "API unavailable" }, { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
