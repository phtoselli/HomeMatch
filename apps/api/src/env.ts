import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Configuração da API, lida e validada uma vez na partida (erro claro em vez de falha no meio de uma busca). */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // API_PORT (não PORT) no desenvolvimento: ferramentas de preview costumam definir PORT para o Vite.
  API_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  /** 127.0.0.1 no computador; 0.0.0.0 num container. */
  HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Pasta com o build do app (o servidor entrega o mapa junto, como no `npm run app`). */
  WEB_DIST: z.string().default(fileURLToPath(new URL("../../web/dist", import.meta.url))),
});

export type Env = z.infer<typeof envSchema> & { port: number; serveWeb: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = envSchema.parse(source);
  // PORT só vale em produção (definido pela hospedagem): no desenvolvimento ele costuma ser a porta do Vite.
  const port = env.API_PORT ?? (env.NODE_ENV === "production" ? env.PORT : undefined) ?? 3333;
  return { ...env, port, serveWeb: existsSync(env.WEB_DIST) };
}
