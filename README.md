# HomeMatch

**Find a place to rent based on where you work, how you get there and what you want nearby.**

HomeMatch is a map-based web app for renting in Brazilian cities. You tell it your city, your workplace, your budget
and what matters to you (a short bus ride, a park, a big supermarket…). It analyses the whole city, highlights the
neighbourhoods that fit, and then searches listings from several real estate portals and local agencies at once.

No account and no database: your favorites and preferences stay in your own browser.

> 🇧🇷 Leia em português: [README.pt-BR.md](README.pt-BR.md)

Live: <https://home-match.pedrotoselli.com>

---

## Run it on your computer (5 minutes)

### 1. Install the requirements

- **Node.js 22 or newer**: download the LTS version from <https://nodejs.org> and install it with the default
  options.
- **Git** (optional, only to clone): <https://git-scm.com>. You can also download the project as a ZIP from GitHub
  (green **Code** button → **Download ZIP**).

Check that Node is installed by opening a terminal (on Windows: *PowerShell*) and running:

```bash
node --version
```

It should print `v22` or higher.

### 2. Get the code

```bash
git clone https://github.com/phtoselli/HomeMatch.git
cd HomeMatch
```

(If you downloaded the ZIP, extract it and open a terminal inside the extracted folder.)

### 3. Install the dependencies

```bash
npm install
```

> **Windows tip:** if PowerShell says running scripts is disabled, use `npm.cmd install` (and `npm.cmd` in the
> commands below).

### 4. Start the app

```bash
npm run app
```

This builds the app, starts the local server and opens <http://localhost:3333> in your browser. To stop it, close the
terminal window (or press `Ctrl+C`). On Windows you can also just double-click **`HomeMatch.cmd`**.

That's it. 🎉

### Using it

1. **Pick your city** and **mark your workplace** (type the address or click on the map).
2. Say **how much you want to pay**, how many bedrooms you need and **what you want nearby** (supermarket, park,
   gym, pharmacy…), then choose what matters most: transit to work or one of the places.
3. Click **Show listings**. The first analysis of a city can take a few minutes; after that it comes from the cache.
4. The map paints each area as **excellent**, **good** or **ok**, and the list shows listings in the best regions
   with the commute time and what matches (or not) your request.
5. Click **Export PDF** to download a **search profile** you can send to a real estate agency: a map with the
   recommended regions and bus lines, your needs and priorities, and search tips. It never includes listings or
   links, only the information the agency needs to search its own catalog.

---

## For developers

```bash
npm run dev        # API on :3333 + web app with hot reload on http://localhost:5173
npm test           # Vitest (parsers with real fixtures, commute model, grid, API routes, PDF data)
npm run typecheck  # each package with its own tsconfig
npm run lint       # ESLint, including the architecture import rules
npm run check      # all of the above + build (what CI runs)
```

Production build without the helper script: `npm run build && npm start` (the server serves the app on
<http://localhost:3333>).

### Deployment

- **App:** a Cloudflare Worker (`apps/edge`, `wrangler.jsonc`) serves the static app on
  <https://home-match.pedrotoselli.com> and forwards `/api/*` to the API. Workers Builds deploys it on every push to
  `main` (`npm run build:cloudflare`, then `npx wrangler deploy`). It fits the Workers free plan.
- **API:** the Fastify API runs as a Vercel function (`npm run build:vercel`), also deployed on every push to `main`.
  The analysis needs more CPU per request than the Workers free plan allows, so the Worker only forwards to it.

```bash
npm run preview:cloudflare   # the Worker locally on http://localhost:8788 (API from Vercel)
npm run deploy:cloudflare    # manual deploy (needs `npx wrangler login`)
```

### Project structure

An npm workspaces monorepo. The full picture is in [docs/architecture.md](docs/architecture.md).

| Folder | What it is |
|---|---|
| `packages/contracts` | Zod schemas of the API and the types derived from them (one source for server and app) |
| `packages/domain` | Pure rules: geo, commute model, grid scoring, filters, "what does not match", timetables |
| `packages/i18n` | Typed text catalogs. The UI ships in Brazilian Portuguese (`locales/pt-BR`) |
| `packages/sources` | Everything that comes from outside: OpenStreetMap, bus operators, portals and agencies |
| `apps/api` | Fastify, in layers: `routes/`, `services/`, `plugins/`, `env.ts` |
| `apps/web` | React + Leaflet, **feature-based** (`features/<name>/`) and **Atomic Design** (`atoms/`, `molecules/`, `organisms/`, `templates/`, `pages/`) |

The web app follows two patterns together:

- **Feature-based**: each feature (`search`, `results`, `map`, `transit`, `links`, `favorites`, `report`) owns its
  components, hooks, stores (`model/`) and helpers (`lib/`), and exposes a public `index.ts`. Features import each
  other only through that index.
- **Atomic Design**: shared UI lives in `shared/ui/{atoms,molecules,organisms}`, each feature splits its components
  the same way, and `app/` holds the `templates/` (page skeletons with slots) and `pages/` (templates filled with
  state). A level only builds on the levels below it (enforced by ESLint).

### Data sources

| Part | Where | Source |
|---|---|---|
| Cities, addresses | `packages/sources/src/osm/nominatim.ts` | Nominatim (max 1 request/s) |
| Lines, stops, places | `packages/sources/src/osm/*`, `transit.ts`, `features.ts` | Overpass API |
| Official bus network (Campinas) | `packages/sources/src/operators/emdec.ts` | EMDEC |
| Scoring and ranking | `packages/domain/src/analysis/grid.ts` | — |
| Listings | `packages/sources/src/listings/*` (engine in `core/`, sites in `extensions/`) | portals + agency websites (robots.txt respected) |
| PDF export | `apps/web/src/features/report` | jsPDF + OpenStreetMap tiles |

Everything fetched from outside is cached in `data/cache/` (Overpass 7 days, listings 6 h, geocoding 30 days).

### Adding a listing site

The shared engine (`packages/sources/src/listings/core/engine.ts`) already handles robots.txt, pacing, cache,
blocking, pagination, monthly total, property type, amenities and map position. An extension only describes what is
specific to the site:

1. Create `packages/sources/src/listings/extensions/<site>.ts` exporting a `SiteExtension` (`core/types.ts`): the
   search page `url(ctx)` and a **pure** `parse(html)` returning `RawListing[]`. If the site publishes schema.org,
   just use `parseSchemaOrgListings`.

Agency websites usually need no extension at all: `extensions/agency.ts` reads a rentals page from schema.org, the
page's app state (`core/appstate.ts`, Next.js/Nuxt sites such as FlipCRM, Arbo, Imobzi) or its HTML cards
(`core/cards.ts`, server-rendered sites such as Union). Discovery (`discovery.ts`) finds the rentals page and the
per-neighborhood pages from the home page, the sitemap and the URL patterns of common platforms. Agencies come from
the ones the user adds in the app, a list per city (`agencies-known.ts`) and OpenStreetMap.
2. Save a trimmed real page in `packages/sources/test/fixtures/` and test the parser in
   `packages/sources/test/listings/extensions.test.ts`.
3. Register it in `packages/sources/src/listings/index.ts` and describe it in `portals.ts`.

### Known limitations

- **Commute times are estimates** (average speed per mode, average wait, at most one transfer). Good for comparing
  regions, not a replacement for a routing app.
- Results depend on what is mapped in OpenStreetMap: big cities are well mapped, smaller ones not always.
- Listing sites change their HTML without notice. When a parser breaks, update its fixture and parser.
- Personal use: the server paces requests and caches results. Please do not run bulk searches.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Security issues:
[SECURITY.md](SECURITY.md), never in a public issue.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). In short (the license text is what counts):

- **You may** use, study, modify and share it, with or without changes, for personal, study, research and hobby
  purposes, and in non-profits, schools and public bodies.
- **You may not** sell it, charge for its use, offer it as a paid service or use it to make money in any way.
- **You must** pass on the license (or its link) and the `Required Notice` line with any copy.

Because it forbids commercial use, it is not an OSI "open source" license: it is source-available, non-commercial.
