# HomeMatch: architecture

HomeMatch is a 100% web application: a React app that consumes the project's own API. **There is no database.**
The user's data (favorites, filters, lines, last search) stays in the browser's `localStorage`; the API reads public
sources on demand, with a cache.

## 1. Principles

- **No database and no login.** Preferences and favorites stay on the device (`localStorage`, keys
  `homematch:<name>`; keys saved by older versions under `mapa-aluguel:` are migrated once at startup). The server
  stores nothing that must survive a deploy.
- **Zero cost.** A Cloudflare Worker on the free plan serves the app on `home-match.pedrotoselli.com`; the API is a
  Vercel function (Hobby plan, personal and non-commercial use). Both are linked to GitHub: every push to `main`
  deploys.
- **Respect the sources.** robots.txt, per-host pacing, cache, no working around blocks, public pages only.
- **Privacy.** The work address only goes through the API during the analysis and is not stored. The PDF export is
  built in the browser.
- **English code, Portuguese UI.** Identifiers, comments, tests and docs are in English; every user-facing text
  lives in the typed catalog of `@homematch/i18n` (`locales/pt-BR`).

## 2. Overview

```
 Browser (React + Leaflet)
   favorites, filters, lines and last search in localStorage; PDF export
        │ HTTPS, same origin (home-match.pedrotoselli.com)
 Cloudflare Worker "home-match" (apps/edge, free plan)
   ├─ static assets: the app (apps/web/dist) + _headers (security headers)
   └─ /api/*: forwarded as is, streaming both ways
        │
 Vercel
   └─ /api/*: Node function in São Paulo (gru1) = the Fastify API (apps/api)
          │  two-level cache: the instance's /tmp + Vercel Runtime Cache
          ▼
   Public sources: Nominatim, Overpass (OpenStreetMap), EMDEC, portals and agency websites
```

## 3. Monorepo

npm workspaces:

```
apps/
  web/          React 18 + Vite: UI and browser state only
  api/          Fastify: thin routes → services → sources and domain
  edge/         Cloudflare Worker: serves the app and forwards /api/* to the API
packages/
  contracts/    zod schemas of the API and derived types (single source); zod-free constants in /constants
  domain/       pure rules: geo, commute, grid and score, filters, "what does not match", lines and timetables
  i18n/         typed text catalogs (pt-BR) shared by server and app; no dependencies
  sources/      everything from outside: http.ts (pacing, cache, network guard), OSM, operators, listings, links
docs/
scripts/        Vercel build and the "run on my computer" shortcut
```

Who may import whom (ESLint blocks the rest):

```
web ──► contracts (types and /constants only), domain, i18n
api ──► contracts, domain, sources, i18n
sources ──► contracts, domain, i18n
domain ──► contracts (types and /constants only), i18n
contracts ──► zod, i18n
i18n ──► (nothing)
```

`domain` uses no network, disk, React or zod: it runs the same in the API, the browser and the tests.

## 4. API

```
apps/api/src/
├─ app.ts        builds the Fastify app (tests use app.inject)
├─ main.ts       listens on a port (local use)
├─ vercel.ts     the same API as a Vercel function
├─ env.ts        configuration validated with zod
├─ plugins/      errors (right status codes) and NDJSON streaming
├─ routes/       only validate the input (contracts) and call the service
└─ services/     region analysis (analysis, commute) and pasted links
```

### Region levels (no maximum time)

There is no maximum commute time. The grid (`domain/analysis/grid.ts`) covers the whole city and each area is judged
by the user's criteria (`domain/analysis/levels.ts`): transit to work and each requested place, weighted 3 (main),
2 (important) or 1 (nice to have).

- **Excellent**: the main criterion is met and so is at least 75% of the weight. **Good**: the main one. **Ok**:
  something else, but not the main one. Nothing met: the area is left out (and its listings do not show).
- **Transit met**: commute up to `commuteRef` (the city's best ride × 1.5, at least 45 min), or up to
  `directRef` (50% more) on a **direct line**, one bus all the way with no transfer, or a stop of a line chosen by
  the user within walking distance. The direct-line allowance keeps the neighborhoods along the line that stops at
  work in the search even when they are a bit farther (Taquaral, Cambuí, Centro on line 353). Living in a
  neighbouring city, the best-served areas still count. A walk longer than 60 minutes is never "transit".
- **Grid**: 250 m cells, so the areas follow the streets near the stops. Listings still match a cell within 375 m
  (portals blur addresses).
- **On the map** (`domain/analysis/areas.ts`): the cells of each level are traced into outlines with rounded corners
  (one shape per level instead of thousands of squares). Levels nest (the "good" area also covers the "excellent" one),
  so the best places come out darkest. The same shapes go into the PDF.
- **Place met**: the nearest one within the requested radius.
- The score (0–100) sums the weights met, each by how well it was met, and sorts within the same level.

In the app, the minimum level ("All", "Good or better", "Excellent only") applies to the map, the region list and the
listings.

### Work in another city

When work is outside the chosen municipality (`services/commute.ts`):

1. The work city comes from Nominatim (`cityAt`, with its boundary).
2. **First, the lines that pass near work** (the work city's network: the official operator, like EMDEC, or OSM).
   They always go on the map and top the line list ("passes near work").
3. An Overpass query (`sources/intercity.ts`) brings the **intercity lines**: bus, train or subway relations that
   stop in both cities (checked against the boundary, because neighbouring cities' bboxes overlap), the home city's
   bus stops and the work city's terminals/bus stations. To stay light, it takes the lines that stop in the home city
   and filters by the work city's bbox (`rel.ra(bbox)`); the ones that really stop there are checked in the parser,
   against the boundary.
4. The work city's network is used for the transfer at the destination: the official operator when there is one
   (EMDEC in Campinas), otherwise the OSM lines near work. The computation is the usual one (`boardingStops` with
   one transfer).
5. With few mapped intercity lines leaving the home city, the terminal estimate kicks in
   (`domain/transit/intercity.ts`): stop near home → work city terminal by highway → city line (or on foot) to work,
   picking the terminal with the shortest time. On the map this leg is dotted (`TransitRoute.estimated`), next to the
   real city line.

Metropolitan lines without open data (EMTU/Artesp sits behind an anti-bot wall and publishes no open GTFS) depend on
OpenStreetMap; where nobody mapped them, the estimate applies.

The app's line searches (`/api/bus`, `/api/bus/near`, `/api/transit/operator`) also receive the work location
(`wlat`, `wlng`): living in Paulínia and working in Campinas, line 353 and the "lines near work" come from EMDEC. Each
analysis line has a role (`TransitRoute.kind`): `nearWork`, `intercity`, `estimated` or `feeder` (transfer), and the
map's list follows that order.

| Method | Route | What it does |
|---|---|---|
| GET | `/api/health` | Health |
| GET | `/api/cities?q=` · `/api/city/:osmId` | City search and boundaries (Nominatim) |
| GET | `/api/geocode?q=` · `/api/reverse?lat=&lng=` | Work address |
| GET | `/api/features` | Features that can be requested (supermarket, park…) |
| GET | `/api/sources?cityId=` | The city's portals and agencies, and whether each can be read |
| POST | `/api/analyze` | Regions that fit the commute and have what the user wants nearby (NDJSON) |
| POST | `/api/listings` | Listings in the chosen regions (NDJSON) |
| POST | `/api/links` | "My links": pasted listings on the map (NDJSON) |
| GET | `/api/transit/operator` · `/api/bus` · `/api/bus/near` · `/api/bus/timetable` | Bus lines and timetables |

Long answers are streamed as **NDJSON** (`progress` / `warning` / `partial` / `result` / `error`): the screen shows
the progress of searches that take minutes.

## 5. React app

Two patterns work together:

- **Feature-based**: each folder in `features/` is a vertical slice (UI, state and hooks of one topic) and is used
  from outside only through its `index.ts`.
- **Atomic Design**: components are split by size and responsibility. `shared/ui` and each feature use the same
  levels, and `app/` adds the two top levels:

| Level | What goes there | Examples |
|---|---|---|
| `atoms/` | Smallest pieces, no other components | `Icon`, `Spinner`, `Switch`, `Photo`, `MatchBadge` |
| `molecules/` | A few atoms working together | `Segmented`, `SwitchField`, `CommuteChip`, `SearchBox`, `ExportPdfButton` |
| `organisms/` | Self-contained sections | `Modal`, `ResultsPanel`, `SetupWizard`, `MapView`, `TopBar` |
| `templates/` | Page skeletons with slots, no data | `MapLayout` |
| `pages/` | A template filled with real state | `HomePage` |

```
apps/web/src/
├─ main.tsx                 entry point (global styles, Providers, App)
├─ app/                     screen composition
│  ├─ App.tsx               renders the page
│  ├─ Providers.tsx         QueryClient (TanStack Query)
│  ├─ model/shell.ts        mode (explore/links) and setup visibility
│  ├─ organisms/TopBar.tsx  search summary, mode switch, export, reset
│  ├─ templates/MapLayout.tsx  header, toolbar, side panel + map, overlay, dialogs
│  └─ pages/HomePage.tsx    wires the feature stores into MapLayout
├─ features/
│  ├─ search/               city, work, criteria and sources
│  │  ├─ components/        molecules/SearchBox; organisms/SetupWizard, FilterBar, PrioritiesPicker, SourcesPicker
│  │  ├─ hooks/             useSearch (analysis and listings, streamed)
│  │  ├─ model/             stores: search (criteria), place (city and work)
│  │  └─ index.ts           public API
│  ├─ results/              listing list, detail and preview
│  │  ├─ components/        atoms/MatchBadge; molecules/CommuteChip, AmenityChips, SortPicker;
│  │  │                     organisms/ResultsPanel, PreviewCard, ListingDetail
│  │  ├─ hooks/useRanked.ts
│  │  └─ lib/listing-text.ts   specs line, price breakdown, best stop
│  ├─ map/                  the map
│  │  ├─ components/organisms/  MapView, Legend, MapSettingsPanel
│  │  ├─ layers/            one layer per file (Cells, Pois, Routes, BusLines, ListingMarkers…)
│  │  ├─ hooks/useLayer.ts  imperative canvas layer
│  │  ├─ lib/leaflet.ts     HTML escaping, line highlight
│  │  └─ model/             stores: settings (visible layers), view (visible area)
│  ├─ transit/              bus lines: popover, timetable, lines store
│  ├─ links/                "My links": panel and store
│  ├─ favorites/            favorites store
│  └─ report/               "Export PDF"
│     ├─ components/molecules/ExportPdfButton.tsx
│     └─ lib/               report-data (pure, tested), map-image (canvas), pdf (jsPDF, loaded on demand)
├─ shared/                  generic, no business rules, unaware of features
│  ├─ ui/                   atoms/ molecules/ organisms/ (CSS Modules)
│  ├─ api/                  typed HTTP client, NDJSON reader, TanStack Query reads
│  ├─ hooks/                useEscape
│  └─ lib/                  persist (localStorage + legacy key migration), format
└─ styles/                  tokens.css (colors, spacing, typography) and app.css
```

Rules (checked by ESLint in `eslint.config.js`):

- **Public API per feature:** from outside, `import { MapView } from "@/features/map"`; never
  `@/features/map/components/organisms/MapView`.
- **Relative paths inside a feature**; outside it, the `@/` alias (`@/shared/ui`, `@/features/x`).
- **Atomic levels only build on lower levels:** atoms do not import molecules or organisms; molecules do not import
  organisms.
- **`shared/` does not depend on `features/` or `app/`**, and features do not depend on `app/`.
- **Contracts as types only in the browser:** `import type` from `@homematch/contracts`; values from
  `@homematch/contracts/constants`. That keeps zod out of the app bundle.
- **No hard-coded UI text:** components read `t.ui.<screen>` from `@homematch/i18n`.
- **State:** one Zustand store per topic in `model/`; what goes to `localStorage` goes through
  `shared/lib/persist.ts`. API reads use TanStack Query.
- **External links** only through `<ExternalLink>` (accepts `http(s)` only); photos through `<Photo>`.
- **Large map layers** (cells, places, lines) are drawn imperatively with `useLayer`, on canvas.

New feature: create `features/<name>/` with the subfolders it needs (`components/{atoms,molecules,organisms}`,
`hooks/`, `model/`, `lib/`) and an `index.ts` exporting only what other parts use.

### PDF export (`features/report`)

"Export PDF" builds a **search profile for a real estate agency**, fully in the browser:

1. `lib/report-data.ts` turns the analysis, filters, priorities and lines into text: client needs, priorities, the
   recommended regions (at or above the chosen level, top 15) with commute, lines and nearby places, the lines that
   serve those regions (with the region numbers they serve) and search tips (neighbourhoods, price range, property,
   must-have items, transit). **No listings and no links.** It is pure and unit tested.
2. `lib/map-image.ts` draws the map on a canvas: OpenStreetMap tiles (loaded with CORS, attribution printed), the
   city boundary, the grid colored by level, the lines serving the regions (estimated legs dotted), numbered regions
   and the work marker. Without tiles, the overlays still render.
3. `lib/pdf.ts` lays out an A4 document with jsPDF (imported only on click): a discreet "HomeMatch" header, a light
   diagonal watermark and page numbers on every page.

## 6. Cache

Every external call goes through `packages/sources/src/http.ts`:

1. **Local disk** (`data/cache/` on a computer, `/tmp/homematch` on Vercel), by namespace and lifetime
   (OSM 7 days, addresses 30 days, listings 6 h).
2. **Vercel Runtime Cache** (`useSharedCache`, enabled in `vercel.ts`) for what lasts a day or more (OSM, addresses,
   bus network), compressed, up to 2 MB per item. It is a cache, not a database: if it fails or the quota runs out,
   the app just gets slower. Listings stay on the local disk only.

**Source outage:** if a query fails (Overpass busy, site down), the cache returns whatever stale value it has (the
shared one keeps 4× the lifetime) instead of failing the search. Overpass tries 5 servers (including both
overpass-api.de machines, `lz4` and `z`, with their own queues) and, if all are busy, goes around once more after a
few seconds. In the analysis, each part that still fails (a kind of place, the lines near work, the neighbourhood
names) becomes a warning and the rest continues.

**Region names:** OSM neighbourhood points and, in a second query, named areas (official neighbourhoods as
administrative boundaries, residential developments, villages). Without a neighbourhood within 2.5 km, the nearest
up to 6 km is used; without any, the city and its side ("Paulínia, zona norte"). Never coordinates: the name is also
used to search the portals.

OpenStreetMap queries ask for the whole city (not the area around work): the same answer serves any search in the
city and the cache almost always hits.

## 7. Security

- **Network (SSRF):** `packages/sources/src/net.ts`. Every server call only talks to public addresses: the URL text
  is checked and the IP is checked at connection time (undici agent with its own `lookup`), which blocks DNS
  rebinding. It applies to pasted links, agency and operator websites coming from OpenStreetMap, and every redirect.
- **Pasted links:** `http(s)` only, up to 5 redirects, pages up to 5 MB, HTML/text only.
- **XSS:** `safeExternalUrl` (domain) filters outside links before they become `href`/`src`; the app uses
  `<ExternalLink>` and `<Photo>`. Leaflet tooltips escape all outside text. CSP with the app's own scripts only.
- **Headers** (in `scripts/build-vercel.mjs`): CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS.
- **Inputs:** zod on every route, coordinates and texts with limits, bodies up to 2 MB.
- **Overpass:** user text is always escaped inside queries.
- **Dependencies:** `npm audit` (production, high level) in CI.

## 8. Deployment

### Cloudflare (app, `home-match.pedrotoselli.com`)

`wrangler.jsonc` defines the Worker `home-match`: static assets from `apps/web/dist` (with a `_headers` file written by
`scripts/build-cloudflare.mjs`, using the same security headers as Vercel from `scripts/security-headers.mjs`), SPA
fallback, and `apps/edge/src/index.ts`, which only runs for `/api/*` and forwards it to `API_ORIGIN` (the Vercel
deployment), streaming both ways. Static requests do not invoke the Worker and the proxy uses almost no CPU, so it
fits the Workers free plan (100k requests/day). The custom domain is a Workers Custom Domain (DNS and certificate
managed by Cloudflare).

Workers Builds (Worker → Settings → Build, connected to the GitHub repo) runs `npm run build:cloudflare` and
`npx wrangler deploy` on every push to `main`. Locally: `npm run preview:cloudflare`; manual deploy:
`npm run deploy:cloudflare`.

Why the API is not on Workers: the free plan allows 10 ms of CPU and 50 external requests per call; the city
analysis parses megabytes of OpenStreetMap data and the listing search reads dozens of sites. Moving it would need
Workers Paid (or a container) and replacing the disk cache and the undici network guard.

### Vercel (API)

Vercel runs `npm ci` and `npm run build:vercel` on every push to `main`. `scripts/build-vercel.mjs` builds
`.vercel/output` (Build Output API), which Vercel deploys as is: `static/` on the CDN and `functions/api.func` (the
whole API in one file, via esbuild) serving `/api/*`, with streaming, a 300 s `maxDuration` and region `gru1`.

Hobby plan limits that matter: each API call may last up to 5 minutes (analysis and listing search fit); the function
can only write to `/tmp`, which disappears when the instance shuts down (hence the second cache level).

To run outside Vercel, the API is a plain Fastify app (`main.ts` listens on a port, `npm run app` serves the app too).

## 9. Next steps

- [ ] Test on phones (small-screen layout) and fix what comes up
- [ ] PWA: manifest and icons for "Add to home screen"
- [ ] Export/import favorites as JSON (`localStorage` is per device: the way to carry them from computer to phone)
- [ ] Move each component's CSS from `styles/app.css` to a CSS Module next to it
- [ ] Per-IP rate limit (Vercel Firewall) if the deployment stops being for the maintainer only
- [ ] A tile provider with a key (MapTiler/Stadia) if usage grows: `tile.openstreetmap.org` tolerates light use
- [ ] Real bus times with GTFS (if the operator publishes it) and more cities with a registered operator
- [ ] English UI catalog (`locales/en`): the i18n package is ready for a second language

## 10. Risks

| Risk | How we handle it |
|---|---|
| Portals block cloud IPs (already happens with ZAP/VivaReal/OLX) | The source shows as "blocked" and the app continues with the others |
| A site changes its HTML and the parser stops finding listings | The warning shows in the search; update fixture and parser |
| Public Overpass slow or down | Two-level cache and alternative servers in `osm/overpass.ts` |
| Free tiers change | The API is a plain Fastify app: it can move to another service without code changes |
| "Cold" function on Vercel | The first call after some idle time takes a few extra seconds |
