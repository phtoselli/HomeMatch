import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mesmo alias do app (apps/web/vite.config.ts): "@/..." = apps/web/src
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }] },
  test: { include: ["{apps,packages}/*/test/**/*.test.ts"], environment: "node" },
});
