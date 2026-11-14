# CLAUDE.md

Guia para o Claude Code neste repositório. Visão geral e limitações no [README](README.md).

## Estrutura

- `src/shared/types.ts`: tipos usados pelo servidor e pelo mapa. Mudou o contrato da API, mude aqui.
- `src/server/`: Fastify (porta `API_PORT`, padrão 3333). Respostas longas (`/api/analyze`, `/api/listings`,
  `/api/links`) são **NDJSON** em streaming (`progress` / `warning` / `partial` / `result` / `error`).
- `src/server/listings/`: fontes de anúncios.
  - `core/engine.ts` é o motor comum (robots.txt, ritmo, cache, bloqueio, paginação, posição no mapa);
    `core/schemaorg.ts` lê anúncios em schema.org (JSON-LD) de qualquer site.
  - `extensions/<site>.ts` tem só o particular de cada site: `url()` da busca + `parse()` puro (contrato em
    `core/types.ts`). Registre em `listings/index.ts` e em `portals.ts`.
  - `discovery.ts` acha as imobiliárias da cidade (OSM `office=estate_agent` com site), reconhece a plataforma
    e lê as que publicam schema.org pela extensão genérica (`extensions/agency.ts`, fonte `site:<host>`).
- `src/web/`: React + react-leaflet 4 (React 18). Camadas grandes (células, POIs, linhas) são desenhadas
  de forma imperativa com `useLayer` em `MapView.tsx`, em canvas, por desempenho.

## Regras

- **Parse puro e testado.** Toda extração de site fica numa função `(html|json) => dados` com teste e
  fixture real em `tests/fixtures/`. O `search`/`resolve` só busca e chama o parse.
- **Toda chamada externa passa por `http.ts`** (`httpFetch`/`cached`): ritmo por host, novas tentativas e cache
  em `data/cache/`. Nominatim: no máximo 1 req/s e User-Agent do app (`APP_UA`).
- **Nada de contornar bloqueio.** Se um site exigir captcha/login ou bloquear, o raspador registra o aviso e
  segue com as outras fontes. Não adicionar plugins de "stealth" nem rotação de IP. Extensões leem só páginas
  públicas de busca (nada de API interna do site com Origin/Referer forjados) e o motor respeita o robots.txt.
- `links.ts` baixa URLs coladas pelo usuário: mantenha `assertPublicUrl` (sem rede local).
- ESM + tsx: imports com extensão `.js` no servidor. No Windows use `npm.cmd`/`npx.cmd` se o PowerShell bloquear `npm`.
- `data/` é cache de conteúdo de terceiros e não vai para o git.

## Comandos

```bash
npm run dev          # API + Vite (proxy ^/api/ → :3333)
npm test             # Vitest
npm run typecheck
```
