// Prepares apps/web/dist for the Cloudflare Worker (wrangler.jsonc → assets): adds a `_headers` file so static files
// get the same security and cache headers as on Vercel. Needs `npm run build` first.
// The Worker itself (apps/edge) serves these files and forwards /api/* to the API.
import { writeFile } from "node:fs/promises";
import { IMMUTABLE, SECURITY_HEADERS } from "./security-headers.mjs";

const lines = (headers) => Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`);

await writeFile(
  "apps/web/dist/_headers",
  ["/*", ...lines(SECURITY_HEADERS), "", "/assets/*", ...lines({ "cache-control": IMMUTABLE }), ""].join("\n"),
);

console.log("Cloudflare: apps/web/dist ready (static app + _headers).");
