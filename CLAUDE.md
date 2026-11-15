# CLAUDE.md

Guia para o Claude Code neste repositório. Visão geral e limitações no [README](README.md).

## Estrutura

Monorepo (npm workspaces). Plano completo em [docs/arquitetura.md](docs/arquitetura.md).

- `packages/contracts`: schemas zod da API e os tipos derivados (`z.infer`). Mudou o contrato da API, mude aqui:
  a validação das rotas e os tipos do app saem do mesmo schema.
- `packages/domain`: regras puras (geo, modelo de trajeto, nota da grade, filtros, "o que não bate", horários).
  Sem rede, disco, React nem zod. Roda igual na API, no navegador e nos testes.
- `packages/sources`: tudo que vem de fora. `http.ts` (ritmo, cache em `DATA_DIR`), `osm/`, `operators/` (EMDEC),
  `listings/`, `links.ts`. A API só importa pelo `index.ts` do pacote.
  - `listings/core/engine.ts` é o motor comum (robots.txt, ritmo, cache, bloqueio, paginação, posição no mapa);
    `core/schemaorg.ts` lê anúncios em schema.org (JSON-LD) de qualquer site.
  - `listings/extensions/<site>.ts` tem só o particular de cada site: `url()` da busca + `parse()` puro (contrato em
    `core/types.ts`). Registre em `listings/index.ts` e em `portals.ts`.
  - `listings/discovery.ts` acha as imobiliárias da cidade (OSM `office=estate_agent` com site), reconhece a plataforma
    e lê as que publicam schema.org pela extensão genérica (`extensions/agency.ts`, fonte `site:<host>`).
- `apps/api`: Fastify. `app.ts` monta (testes usam `app.inject`), `main.ts` escuta, `vercel.ts` é a mesma API como
  função da Vercel (empacotada por `scripts/build-vercel.mjs`), `env.ts` valida a configuração,
  `routes/` só valida e chama, `services/` orquestra fontes + domínio, `plugins/` (erros, streaming).
  Respostas longas (`/api/analyze`, `/api/listings`, `/api/links`) são **NDJSON** em streaming
  (`progress` / `warning` / `partial` / `result` / `error`).
- `apps/web`: React 18 + react-leaflet 4.
  - `features/<assunto>/`: componentes, store (Zustand) e hooks de cada parte (search, results, favorites, map,
    transit, links). `app/` compõe a tela.
  - `shared/ui`: peças reutilizáveis sem regra de negócio (Modal, Switch, Segmented, Spinner, CloseButton, Icon…),
    com CSS Modules. `shared/api`: cliente HTTP e leituras com TanStack Query. `shared/lib/persist.ts`: preferências
    no localStorage (chaves `mapa-aluguel:<nome>`, mantidas entre versões).
  - Camadas grandes do mapa (células, POIs, linhas) são desenhadas de forma imperativa com `useLayer` em
    `features/map/MapView.tsx`, em canvas, por desempenho.

## Regras

- **Parse puro e testado.** Toda extração de site fica numa função `(html|json) => dados` com teste e
  fixture real em `packages/sources/test/fixtures/`. O `search`/`resolve` só busca e chama o parse.
- **Toda chamada externa passa por `http.ts`** (`httpFetch`/`cached`): ritmo por host, novas tentativas e cache
  em `data/cache/` (na Vercel, também no Runtime Cache para o que vale 1 dia ou mais). Nominatim: no máximo 1 req/s e User-Agent do app (`APP_UA`).
- **Nada de contornar bloqueio.** Se um site exigir captcha/login ou bloquear, o raspador registra o aviso e
  segue com as outras fontes. Não adicionar plugins de "stealth" nem rotação de IP. Extensões leem só páginas
  públicas de busca (nada de API interna do site com Origin/Referer forjados) e o motor respeita o robots.txt.
- `links.ts` baixa URLs coladas pelo usuário: mantenha `assertPublicUrl` (sem rede local).
- **Dependências entre pacotes** seguem as setas da arquitetura; o ESLint (`no-restricted-imports`) barra o resto
  (ex.: `domain` não importa `sources`, o app não importa `sources` nem Node).
- Regra nova que vale para servidor e app vai para `domain`, com teste. Componente que se repete vai para `shared/ui`.
- ESM + tsx: imports com extensão `.js` nos pacotes e na API. No Windows use `npm.cmd`/`npx.cmd` se o PowerShell bloquear `npm`.
- `data/` é cache de conteúdo de terceiros e não vai para o git.
- Sem banco de dados: o que é da pessoa fica no localStorage; o servidor lê os sites na hora, com cache em arquivo
  (`/tmp` na Vercel). Nada de estado no servidor que precise sobreviver a um deploy.

## Comandos

```bash
npm run dev          # API + Vite (proxy ^/api/ → :3333)
npm test             # Vitest (todos os pacotes)
npm run typecheck    # tsc em cada pacote
npm run lint
npm run format       # Prettier
npm run check        # o que o CI roda: lint, tipos, testes e build
npm run build:vercel # o que a Vercel roda a cada push na main (.vercel/output)
```

Produção: projeto `home-match` na Vercel (https://home-match-delta.vercel.app), publica a cada push na `main`.
A pasta está ligada pela CLI (`.vercel/project.json`); no PowerShell use `vercel.cmd` (`vercel.cmd ls`,
`vercel.cmd logs <url>`, `vercel.cmd env ls`).
