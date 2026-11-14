// Abre o HomeMatch para uso: monta o mapa, sobe o servidor e abre o navegador.
// Uso: `npm run app` (ou dois cliques em HomeMatch.cmd no Windows).
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
    const r = await fetch(`http://127.0.0.1:${port}/api/features`);
    return r.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  console.log(`\nHomeMatch aberto em ${url}\nPara fechar, feche esta janela (ou Ctrl+C).\n`);
}

if (!existsSync(bin("vite/bin/vite.js")) || !existsSync(bin("tsx/dist/cli.mjs"))) {
  console.log("Instalando dependências (só na primeira vez)…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["install"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("Montando o mapa…");
const build = spawnSync(process.execPath, [bin("vite/bin/vite.js"), "build", "--logLevel", "warn"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

if (await up()) {
  // Já tem um servidor na porta (ex.: o `npm run dev`). Se ele entrega o mapa, é só abrir.
  const page = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
  if (page?.ok) {
    console.log("O servidor já está rodando.");
    openBrowser();
  } else {
    url = "http://localhost:5173";
    console.log(`A porta ${port} está com o modo de desenvolvimento (npm run dev).`);
    openBrowser();
  }
  process.exit(0);
}

console.log("Subindo o servidor…");
const server = spawn(process.execPath, [bin("tsx/dist/cli.mjs"), "src/server/index.ts"], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"], // log de cada requisição fica de fora; erros aparecem
  env: { ...process.env, API_PORT: String(port) },
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill());

for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
if (await up()) openBrowser();
else console.error(`O servidor não respondeu em ${url}. Veja os erros acima.`);
