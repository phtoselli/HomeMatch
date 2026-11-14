import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = await buildApp(env);

// Encerra limpo (Ctrl+C, parada do container): termina as respostas em andamento antes de sair.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: env.port, host: env.HOST });
