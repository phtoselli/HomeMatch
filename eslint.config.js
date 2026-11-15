import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Quem pode importar quem: as setas da arquitetura (docs/arquitetura.md). Cada grupo de arquivos recebe a lista
 * completa de proibições (no ESLint, a última regra que casa com o arquivo substitui as anteriores).
 */
const RULE = "@typescript-eslint/no-restricted-imports";
const forbid = (groups, paths = []) => ({
  "no-restricted-imports": "off",
  [RULE]: ["error", { paths, patterns: groups.map(([group, message]) => ({ group, message })) }],
});
const NODE = [["node:*", "fs", "path", "crypto"], "Sem Node aqui: este código também roda no navegador."];
const UI = [["react", "react-*", "leaflet", "zustand", "@tanstack/*"], "Sem interface aqui."];
const SERVER = [["fastify", "@fastify/*", "linkedom", "undici"], "Isso é do servidor."];
const pkg = (...names) => [
  names.map((n) => `@homematch/${n}`),
  `Este pacote não pode depender de @homematch/${names.join(", ")}.`,
];
/** O índice dos contratos carrega o zod: no navegador e no domínio, só tipos (valores vêm de /constants). */
const CONTRACT_TYPES_ONLY = {
  name: "@homematch/contracts",
  allowTypeImports: true,
  message: 'Daqui só `import type`; valores em "@homematch/contracts/constants" (o zod fica no servidor).',
};

// App React (apps/web/src): features/<nome> só por fora pelo index.ts; shared não conhece features nem app.
const WEB = [pkg("sources", "api"), NODE, SERVER];
const FEATURE_INDEX = [["@/features/*/**"], "Use a API pública da funcionalidade: @/features/<nome> (index.ts)."];
const NO_APP = [["@/app", "@/app/**"], "Funcionalidades e shared não dependem da composição da tela (app/)."];
const NO_FEATURES = [["@/features", "@/features/**"], "shared/ é genérico: não depende de funcionalidades."];
const LEAVE_FEATURE = (up) => [[`${up}**`], "Fora da própria funcionalidade, importe por @/ (ex.: @/shared/ui)."];

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
  // contracts: só zod. domain: só tipos e constantes dos contratos, nada de rede, disco, tela nem zod.
  { files: ["packages/contracts/src/**"], rules: forbid([pkg("domain", "sources", "api", "web"), NODE, UI, SERVER]) },
  {
    files: ["packages/domain/src/**"],
    rules: forbid(
      [pkg("sources", "api", "web"), NODE, UI, SERVER, [["zod"], "Validação mora nos contratos."]],
      [CONTRACT_TYPES_ONLY],
    ),
  },
  { files: ["packages/sources/src/**"], rules: forbid([pkg("api", "web"), UI]) },
  { files: ["apps/api/src/**"], rules: forbid([pkg("web"), UI]) },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...forbid([...WEB, FEATURE_INDEX], [CONTRACT_TYPES_ONLY]),
    },
  },
  { files: ["apps/web/src/shared/**"], rules: forbid([...WEB, NO_FEATURES, NO_APP], [CONTRACT_TYPES_ONLY]) },
  // Arquivo na raiz da funcionalidade (index.ts, types.ts) ou numa subpasta (components/, model/, layers/…).
  {
    files: ["apps/web/src/features/*/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../")], [CONTRACT_TYPES_ONLY]),
  },
  {
    files: ["apps/web/src/features/*/*/**/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../../")], [CONTRACT_TYPES_ONLY]),
  },
  { files: ["apps/web/vite.config.ts"], rules: { [RULE]: "off" } },
  { files: ["**/test/**"], rules: { [RULE]: "off" } },
);
