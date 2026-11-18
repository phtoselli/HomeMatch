import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** API configuration, read and validated once at startup (a clear error instead of a failure mid-search). */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // API_PORT (not PORT) in development: preview tools usually set PORT for Vite.
  API_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  /** 127.0.0.1 on a computer; 0.0.0.0 in a container. */
  HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Folder with the app build (the server serves the map too, as in `npm run app`). */
  WEB_DIST: z.string().default(fileURLToPath(new URL("../../web/dist", import.meta.url))),
});

export type Env = z.infer<typeof envSchema> & { port: number; serveWeb: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = envSchema.parse(source);
  // PORT only applies in production (set by the host): in development it is usually Vite's port.
  const port = env.API_PORT ?? (env.NODE_ENV === "production" ? env.PORT : undefined) ?? 3333;
  return { ...env, port, serveWeb: existsSync(env.WEB_DIST) };
}
