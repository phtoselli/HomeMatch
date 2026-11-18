import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = await buildApp(env);

// Clean shutdown (Ctrl+C, container stop): finish in-flight responses before exiting.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: env.port, host: env.HOST });
