import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Quem pode importar quem: as setas da arquitetura (docs/arquitetura.md, seção 3.3). */
const forbid = (...groups) => ({
  "no-restricted-imports": ["error", { patterns: groups.map(([group, message]) => ({ group, message })) }],
});
const NODE = [["node:*", "fs", "path", "crypto"], "Sem Node aqui: este código também roda no navegador."];
const UI = [["react", "react-*", "leaflet", "zustand", "@tanstack/*"], "Sem interface aqui."];
const SERVER = [["fastify", "@fastify/*", "linkedom"], "Isso é do servidor."];
const pkg = (...names) => [
  names.map((n) => `@homematch/${n}`),
  `Este pacote não pode depender de @homematch/${names.join(", ")}.`,
];

export default tseslint.config(
  { ignores: [".vercel/**", "**/dist/**", "**/node_modules/**", "data/**", "**/*.d.ts", "**/test/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      eqeqeq: ["error", "smart"],
    },
  },
  // contracts: só zod. domain: só contracts, nada de rede, disco ou tela.
  { files: ["packages/contracts/src/**"], rules: forbid(pkg("domain", "sources", "api", "web"), NODE, UI, SERVER) },
  {
    files: ["packages/domain/src/**"],
    rules: forbid(pkg("sources", "api", "web"), NODE, UI, SERVER, [["zod"], "Validação mora nos contratos."]),
  },
  { files: ["packages/sources/src/**"], rules: forbid(pkg("api", "web"), UI) },
  { files: ["apps/api/src/**"], rules: forbid(pkg("web"), UI) },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...forbid(pkg("sources", "api"), NODE, SERVER),
    },
  },
  { files: ["apps/web/vite.config.ts"], rules: { "no-restricted-imports": "off" } },
  { files: ["**/test/**"], rules: { "no-restricted-imports": "off" } },
);
