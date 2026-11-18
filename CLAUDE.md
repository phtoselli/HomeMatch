# CLAUDE.md

Guide for Claude Code in this repository. Overview and limitations in the [README](README.md).

## Structure

npm workspaces monorepo. Full design in [docs/architecture.md](docs/architecture.md).

- **Language:** code, comments, tests and docs in English. UI text in Brazilian Portuguese, only in the typed catalog
  `packages/i18n/src/locales/pt-BR` (read as `t.<area>` / `t.ui.<screen>`). Never hard-code UI text in components.
- `packages/contracts`: zod schemas of the API and the derived types (`z.infer`). If the API contract changes, change
  it here: route validation and app types come from the same schema.
- `packages/domain`: pure rules (geo, commute model, grid score and levels, filters, "what does not match",
  timetables, legacy id migration in `storage/legacy.ts`). No network, disk, React or zod. Runs the same in the API,
  the browser and the tests.
- `packages/i18n`: text catalogs, no dependencies. Messages that take values are functions.
- `packages/sources`: everything from outside. `http.ts` (pacing, cache in `DATA_DIR`), `osm/`, `operators/` (EMDEC),
  `intercity.ts` (OSM intercity lines between two cities + terminals), `listings/`, `links.ts`. The API imports only
  through the package's `index.ts`.
  - `listings/core/engine.ts` is the shared engine (robots.txt, pacing, cache, blocking, pagination, map position);
    `core/schemaorg.ts` reads schema.org (JSON-LD) listings from any site.
  - `listings/extensions/<site>.ts` holds only what is specific to each site: the search `url()` + a pure `parse()`
    (contract in `core/types.ts`). Register in `listings/index.ts` and `portals.ts`.
  - `listings/discovery.ts` finds the city's agencies (OSM `office=estate_agent` with a website), recognizes the
    platform and reads the ones that publish schema.org through the generic extension (`extensions/agency.ts`,
    source `site:<host>`).
- `apps/api`: Fastify. `app.ts` builds it (tests use `app.inject`), `main.ts` listens, `vercel.ts` is the same API as
  a Vercel function (bundled by `scripts/build-vercel.mjs`), `env.ts` validates configuration, `routes/` only
  validate and call, `services/` orchestrate sources + domain (`commute.ts`: the analysis' transit network, same city
  or intercity), `plugins/` (errors, streaming). Long answers (`/api/analyze`, `/api/listings`, `/api/links`) are
  streamed **NDJSON** (`progress` / `warning` / `partial` / `result` / `error`).
- `apps/web`: React 18 + react-leaflet 4, **feature-based + Atomic Design** (details in
  [docs/architecture.md](docs/architecture.md#5-react-app)).
  - `features/<topic>/` (search, results, map, transit, links, favorites, report): `components/{atoms,molecules,
    organisms}/`, `hooks/`, `model/` (Zustand stores), `lib/` and an `index.ts` with the public API. From outside,
    only `@/features/<topic>`; inside, relative paths.
  - `app/`: `organisms/` (TopBar), `templates/` (MapLayout, slots only), `pages/` (HomePage wires the stores),
    `model/shell.ts`.
  - `shared/ui/{atoms,molecules,organisms}`: reusable pieces without business rules, with CSS Modules.
    `shared/api`: HTTP client and TanStack Query reads. `shared/lib/persist.ts`: preferences in localStorage (keys
    `homematch:<name>`; old `mapa-aluguel:` keys are migrated once). `shared/` does not import features.
  - Atomic levels only build on lower ones (atoms ↛ molecules/organisms; molecules ↛ organisms).
  - Map layers: one file per layer in `features/map/layers/`, drawn imperatively with `useLayer`, on canvas.
  - `features/report`: "Export PDF" (search profile for an agency; jsPDF loaded on demand; no listings or links).
  - Alias `@/` = `apps/web/src` (Vite, tsconfig and Vitest).

## Rules

- **Pure, tested parsing.** Every site extraction is a `(html|json) => data` function with a test and a real
  fixture in `packages/sources/test/fixtures/`. `search`/`resolve` only fetch and call the parser.
- **Every external call goes through `http.ts`** (`httpFetch`/`cached`): per-host pacing, retries and cache in
  `data/cache/` (on Vercel, also in the Runtime Cache for what lasts a day or more). Nominatim: at most 1 req/s with
  the app's User-Agent (`APP_UA`).
- **No working around blocks.** If a site requires a captcha/login or blocks us, the scraper logs a warning and moves
  on. No "stealth" plugins or IP rotation. Extensions read only public search pages (no internal site APIs with
  forged Origin/Referer) and the engine respects robots.txt.
- **Public network only:** `net.ts` checks the URL and the IP at connection time for every `httpFetch` call (pasted
  links and sites from OSM are third-party). Never call `fetch` directly or disable `publicDispatcher`.
- **Outside links become `href`/`src` only through `safeExternalUrl`** (domain): in the app, `<ExternalLink>` and
  `<Photo>`. Outside text in Leaflet HTML goes through `esc` (`features/map/lib/leaflet.ts`).
- In the app and the domain, `@homematch/contracts` only with `import type`; values from
  `@homematch/contracts/constants`.
- **Package dependencies** follow the architecture arrows; ESLint (`no-restricted-imports`) blocks the rest (e.g.
  `domain` does not import `sources`, the app does not import `sources` or Node).
- A new rule shared by server and app goes to `domain`, with a test. A repeated component goes to `shared/ui`, at the
  right atomic level.
- ESM + tsx: `.js` extensions in imports in the packages and the API. On Windows use `npm.cmd`/`npx.cmd` if
  PowerShell blocks `npm`.
- `data/` is a cache of third-party content and does not go into git.
- No database: user data stays in localStorage; the server reads the sites on demand, with a file cache (`/tmp` on
  Vercel). No server state that must survive a deploy.

## Commands

```bash
npm run dev          # API + Vite (proxy ^/api/ → :3333)
npm test             # Vitest (all packages)
npm run typecheck    # tsc in each package
npm run lint
npm run format       # Prettier
npm run check        # what CI runs: lint, types, tests and build
npm run build:vercel   # what Vercel runs on every push to main (.vercel/output)
npm run preview:vercel # serves that build locally with Vercel's headers (local API on :3333)
```

Production: Vercel project `home-match` (https://home-match-delta.vercel.app), deploys on every push to `main`.
The folder is linked through the CLI (`.vercel/project.json`); in PowerShell use `vercel.cmd` (`vercel.cmd ls`,
`vercel.cmd logs <url>`, `vercel.cmd env ls`).
