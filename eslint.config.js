import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Who may import whom: the arrows of the architecture (docs/architecture.md). Each group of files gets its full
 * list of restrictions (in ESLint, the last matching rule replaces earlier ones).
 */
const RULE = "@typescript-eslint/no-restricted-imports";
const forbid = (groups, paths = []) => ({
  "no-restricted-imports": "off",
  [RULE]: ["error", { paths, patterns: groups.map(([group, message]) => ({ group, message })) }],
});
const NODE = [["node:*", "fs", "path", "crypto"], "No Node here: this code also runs in the browser."];
const UI = [["react", "react-*", "leaflet", "zustand", "@tanstack/*"], "No UI here."];
const SERVER = [["fastify", "@fastify/*", "linkedom", "undici"], "That belongs to the server."];
const pkg = (...names) => [
  names.map((n) => `@homematch/${n}`),
  `This package must not depend on @homematch/${names.join(", ")}.`,
];
/** The contracts index loads zod: in the browser and in the domain, import types only (values come from /constants). */
const CONTRACT_TYPES_ONLY = {
  name: "@homematch/contracts",
  allowTypeImports: true,
  message: 'Use `import type` here; runtime values live in "@homematch/contracts/constants" (zod stays on the server).',
};

// React app (apps/web/src): features/<name> are used from outside only through index.ts; shared knows no features.
const WEB = [pkg("sources", "api"), NODE, SERVER];
const FEATURE_INDEX = [["@/features/*/**"], "Use the feature's public API: @/features/<name> (index.ts)."];
const NO_APP = [["@/app", "@/app/**"], "Features and shared code do not depend on the screen composition (app/)."];
const NO_FEATURES = [["@/features", "@/features/**"], "shared/ is generic: it does not depend on features."];
const LEAVE_FEATURE = (up) => [[`${up}**`], "Outside your own feature, import through @/ (e.g. @/shared/ui)."];
// Atomic Design: a level only builds on the levels below it (atoms → molecules → organisms → templates → pages).
const ATOM = [
  ["../molecules/**", "../organisms/**"],
  "Atoms are the smallest pieces: they do not use molecules or organisms.",
];
const MOLECULE = [["../organisms/**"], "Molecules do not use organisms."];

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
  // i18n: plain message catalogs, no dependencies at all.
  {
    files: ["packages/i18n/src/**"],
    rules: forbid([pkg("contracts", "domain", "sources", "api", "web"), NODE, UI, SERVER, [["zod"], "No zod here."]]),
  },
  // contracts: zod and i18n only. domain: contract types and constants, no network, disk, UI or zod.
  { files: ["packages/contracts/src/**"], rules: forbid([pkg("domain", "sources", "api", "web"), NODE, UI, SERVER]) },
  {
    files: ["packages/domain/src/**"],
    rules: forbid(
      [pkg("sources", "api", "web"), NODE, UI, SERVER, [["zod"], "Validation lives in the contracts."]],
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
  {
    files: ["apps/web/src/shared/ui/atoms/**"],
    rules: forbid([...WEB, NO_FEATURES, NO_APP, ATOM], [CONTRACT_TYPES_ONLY]),
  },
  {
    files: ["apps/web/src/shared/ui/molecules/**"],
    rules: forbid([...WEB, NO_FEATURES, NO_APP, MOLECULE], [CONTRACT_TYPES_ONLY]),
  },
  // A file at the feature root (index.ts, types.ts) or in a subfolder (components/, model/, layers/…).
  {
    files: ["apps/web/src/features/*/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../")], [CONTRACT_TYPES_ONLY]),
  },
  {
    files: ["apps/web/src/features/*/*/**/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../../")], [CONTRACT_TYPES_ONLY]),
  },
  // Components sit one folder deeper, in their Atomic Design level: components/<atoms|molecules|organisms>/.
  {
    files: ["apps/web/src/features/*/components/*/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../../../")], [CONTRACT_TYPES_ONLY]),
  },
  {
    files: ["apps/web/src/features/*/components/atoms/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../../../"), ATOM], [CONTRACT_TYPES_ONLY]),
  },
  {
    files: ["apps/web/src/features/*/components/molecules/*.{ts,tsx}"],
    rules: forbid([...WEB, FEATURE_INDEX, NO_APP, LEAVE_FEATURE("../../../"), MOLECULE], [CONTRACT_TYPES_ONLY]),
  },
  { files: ["apps/web/vite.config.ts"], rules: { [RULE]: "off" } },
  { files: ["**/test/**"], rules: { [RULE]: "off" } },
);
