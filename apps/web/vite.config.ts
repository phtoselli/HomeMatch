import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.API_PORT ?? "3333";

export default defineConfig({
  plugins: [react()],
  // "@/..." = apps/web/src (imports entre pastas do app sem "../../..")
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) }] },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "^/api/": { target: `http://127.0.0.1:${apiPort}`, timeout: 0, proxyTimeout: 0 } },
  },
});
