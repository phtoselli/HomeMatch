// Builds the Vercel deployment in the Build Output API format (.vercel/output):
//   static/            the React app (apps/web/dist), served by the CDN
//   functions/api.func the whole API in a single file (esbuild), in São Paulo, with streaming (NDJSON)
// Run by Vercel on every push to main (vercel.json → buildCommand). Needs `npm run build` first.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { IMMUTABLE, SECURITY_HEADERS } from "./security-headers.mjs";

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

await json(`${OUT}/config.json`, {
  version: 3,
  routes: [
    { src: "/(.*)", headers: SECURITY_HEADERS, continue: true },
    { src: "^/assets/(.*)$", headers: { "cache-control": IMMUTABLE }, continue: true },
    { src: "^/api(?:/.*)?$", dest: "/api" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ],
});

console.log(`Vercel: ${OUT} ready (static app + /api function).`);
