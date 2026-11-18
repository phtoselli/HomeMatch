// Builds the Vercel deployment in the Build Output API format (.vercel/output):
//   static/            the React app (apps/web/dist), served by the CDN
//   functions/api.func the whole API in a single file (esbuild), in São Paulo, with streaming (NDJSON)
// Run by Vercel on every push to main (vercel.json → buildCommand). Needs `npm run build` first.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const OUT = ".vercel/output";
const FN = `${OUT}/functions/api.func`;

await rm(OUT, { recursive: true, force: true });
await cp("apps/web/dist", `${OUT}/static`, { recursive: true });

await mkdir(FN, { recursive: true });
await build({
  entryPoints: ["apps/api/src/vercel.ts"],
  outfile: `${FN}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  logLevel: "warning",
  banner: {
    js: [
      // CommonJS packages inside the ESM bundle still call require().
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
      // Only /tmp is writable in the function: the sources cache goes there (it lasts while the instance lives).
      'process.env.DATA_DIR ??= "/tmp/homematch";',
    ].join("\n"),
  },
});

const json = (path, data) => writeFile(path, JSON.stringify(data, null, 2));

await json(`${FN}/.vc-config.json`, {
  runtime: "nodejs22.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  // Analysis and listing search take minutes (respecting each site's pace).
  maxDuration: 300,
  // São Paulo: close to the sites read, and they see a visit from Brazil.
  regions: ["gru1"],
});

// Security headers on everything (app and API). The CSP only runs the app's own scripts: even if an outside link
// slipped past the filter (`safeExternalUrl`), a `javascript:` URL would not run. Images come from any https site
// (listing photos, map tiles); inline style is needed by Leaflet (markers with `style`).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

await json(`${OUT}/config.json`, {
  version: 3,
  routes: [
    { src: "/(.*)", headers: SECURITY_HEADERS, continue: true },
    { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
    { src: "^/api(?:/.*)?$", dest: "/api" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ],
});

console.log(`Vercel: ${OUT} ready (static app + /api function).`);
