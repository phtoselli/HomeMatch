// Monta o deploy da Vercel no formato Build Output API (.vercel/output):
//   static/            o app React (apps/web/dist), servido pela CDN
//   functions/api.func a API inteira num arquivo só (esbuild), em São Paulo, com streaming (NDJSON)
// Rodado pela Vercel a cada push na main (vercel.json → buildCommand). Precisa do `npm run build` antes.
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
      // Pacotes CommonJS dentro do bundle ESM ainda chamam require().
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
      // Na função só /tmp aceita escrita: o cache das fontes vai para lá (dura enquanto a instância viver).
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
  // Análise e busca de imóveis levam minutos (respeitando o ritmo de cada site).
  maxDuration: 300,
  // São Paulo: perto dos sites lidos, e eles veem um acesso do Brasil.
  regions: ["gru1"],
});

await json(`${OUT}/config.json`, {
  version: 3,
  routes: [
    { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
    { src: "^/api(?:/.*)?$", dest: "/api" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ],
});

console.log(`Vercel: ${OUT} pronto (app estático + função /api).`);
