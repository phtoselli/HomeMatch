# Contributing

Thanks for your interest in HomeMatch. This guide explains how to run the project, the code rules and what we
expect from a pull request.

## License of contributions

HomeMatch is distributed under the [PolyForm Noncommercial 1.0.0](LICENSE): anyone can use, study, modify and
share it, **as long as it is not for commercial purposes**. By sending a contribution, you agree that it is
distributed under the same terms.

## Setting up

You need Node.js 22 or newer (the same as Vercel and CI).

```bash
npm install
npm run dev     # API on :3333 + app on http://localhost:5173
```

There is no database or extra service to start: the API reads public sources on demand, with a cache in `data/`
(not in git), and the app keeps the user's preferences in the browser's `localStorage`.

## Before opening a pull request

```bash
npm run check   # formatting, lint, types, tests and build: the same as CI
```

Checklist:

- [ ] `npm run check` passes.
- [ ] Changed a business rule? It lives in `packages/domain`, with a test.
- [ ] Changed the API contract? The schema in `packages/contracts` changed (route validation and app types come from it).
- [ ] Touched a scraper? The parser is a pure function with a test and a real fixture in `packages/sources/test/fixtures/`.
- [ ] New UI text? It goes into the catalog in `packages/i18n/src/locales/pt-BR`, never hard-coded in a component.
- [ ] Nothing stored on the server that must survive: user data stays in `localStorage`.

## Project rules

- **Language:** code, comments, tests and docs are in English. UI text is in Brazilian Portuguese, in the
  `@homematch/i18n` catalog.
- **Architecture:** a monorepo with `apps/web`, `apps/api` and `packages/{contracts,domain,i18n,sources}`. The
  dependency arrows are in [docs/architecture.md](docs/architecture.md) and ESLint blocks the rest.
- **React app:** feature-based (`src/features/<name>/`) and Atomic Design (`atoms/`, `molecules/`, `organisms/`,
  then `templates/` and `pages/` in `src/app/`). A feature is used from outside only through its `index.ts`;
  pieces without business rules go to `src/shared/ui`. Details in
  [docs/architecture.md](docs/architecture.md#5-react-app).
- **Respect the sources:** every external call goes through `packages/sources/src/http.ts` (per-host pacing,
  retries, cache). No working around blocks: if a site asks for a captcha, a login or blocks us, the scraper logs a
  warning and moves on to the other sources. No "stealth" plugins, no IP rotation, no internal site APIs with forged
  headers. The engine respects `robots.txt`.
- **Nominatim:** at most 1 request per second, with the app's User-Agent.
- **Links pasted by the user:** public addresses only (`assertPublicUrl` + DNS check at connection time).
- **Links from outside** (listings, OpenStreetMap, operator sites) only become an `href` after
  `safeExternalUrl` (only `http`/`https`).

## Reporting problems

- Bugs and ideas: open an issue with the templates in `.github/ISSUE_TEMPLATE/`.
- Security issues: **do not** open a public issue; see [SECURITY.md](SECURITY.md).

Follow the [code of conduct](CODE_OF_CONDUCT.md) in issues, pull requests and discussions.
