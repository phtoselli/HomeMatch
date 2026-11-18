// Starts HomeMatch for everyday use: builds the map, starts the server and opens the browser.
// Usage: `npm run app` (or double-click HomeMatch.cmd on Windows).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.API_PORT ?? 3333);
let url = `http://localhost:${port}`;
const bin = (p) => join(root, "node_modules", p);

async function up() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  console.log(`\nHomeMatch is running at ${url}\nTo stop it, close this window (or press Ctrl+C).\n`);
}

if (!existsSync(bin("vite/bin/vite.js")) || !existsSync(bin("tsx/dist/cli.mjs"))) {
  console.log("Installing dependencies (first run only)…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["install"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("Building the map…");
const build = spawnSync(process.execPath, [bin("vite/bin/vite.js"), "build", "--logLevel", "warn"], {
  cwd: join(root, "apps", "web"),
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

if (await up()) {
  // A server is already on the port (e.g. `npm run dev`). If it serves the map, just open it.
  const page = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
  if (page?.ok) {
    console.log("The server is already running.");
    openBrowser();
  } else {
    url = "http://localhost:5173";
    console.log(`Port ${port} is running in development mode (npm run dev).`);
    openBrowser();
  }
  process.exit(0);
}

console.log("Starting the server…");
const server = spawn(process.execPath, [bin("tsx/dist/cli.mjs"), "apps/api/src/main.ts"], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"], // log de cada requisição fica de fora; erros aparecem
  env: { ...process.env, API_PORT: String(port) },
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill());

for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
if (await up()) openBrowser();
else console.error(`The server did not answer at ${url}. See the errors above.`);
