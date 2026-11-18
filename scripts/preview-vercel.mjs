// Serves .vercel/output locally with the same routes and headers (CSP etc.) as Vercel, proxying /api to the local
// API. Useful to check the production build before pushing:
//   npm run build:vercel && npm run dev:api   (in another terminal)   and   npm run preview:vercel
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { extname, join, normalize } from "node:path";

const OUT = ".vercel/output";
const STATIC = join(OUT, "static");
const PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const API = new URL(process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 3333}`);

if (!existsSync(join(OUT, "config.json"))) {
  console.error("Run first: npm run build:vercel");
  process.exit(1);
}
const { routes } = JSON.parse(readFileSync(join(OUT, "config.json"), "utf8"));
const headerRoutes = routes.filter((r) => r.headers).map((r) => ({ re: new RegExp(r.src), headers: r.headers }));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  for (const r of headerRoutes)
    if (r.re.test(path)) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);

  if (/^\/api(\/|$)/.test(path)) {
    const up = request(
      { host: API.hostname, port: API.port, path: req.url, method: req.method, headers: req.headers },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
      },
    );
    up.on("error", () => {
      res.writeHead(502).end("API local fora do ar");
    });
    req.pipe(up);
    return;
  }

  let file = normalize(join(STATIC, path));
  if (!file.startsWith(normalize(STATIC)) || !existsSync(file) || statSync(file).isDirectory())
    file = join(STATIC, "index.html");
  res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`Vercel build at http://127.0.0.1:${PORT} (API: ${API.origin})`));
