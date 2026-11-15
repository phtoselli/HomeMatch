# CLAUDE.md

Guia para o Claude Code neste repositório. Visão geral e limitações no [README](README.md).

## Estrutura

Monorepo (npm workspaces). Plano completo em [docs/arquitetura.md](docs/arquitetura.md).

- `packages/contracts`: schemas zod da API e os tipos derivados (`z.infer`). Mudou o contrato da API, mude aqui:
  a validação das rotas e os tipos do app saem do mesmo schema.
- `packages/domain`: regras puras (geo, modelo de trajeto, nota da grade, filtros, "o que não bate", horários).
  Sem rede, disco, React nem zod. Roda igual na API, no navegador e nos testes.
- `packages/sources`: tudo que vem de fora. `http.ts` (ritmo, cache em `DATA_DIR`), `osm/`, `operators/` (EMDEC),
  `intercity.ts` (linhas intermunicipais do OSM entre duas cidades + terminais), `listings/`, `links.ts`. A API só
  importa pelo `index.ts` do pacote.
  - `listings/core/engine.ts` é o motor comum (robots.txt, ritmo, cache, bloqueio, paginação, posição no mapa);
    `core/schemaorg.ts` lê anúncios em schema.org (JSON-LD) de qualquer site.
  - `listings/extensions/<site>.ts` tem só o particular de cada site: `url()` da busca + `parse()` puro (contrato em
    `core/types.ts`). Registre em `listings/index.ts` e em `portals.ts`.
  - `listings/discovery.ts` acha as imobiliárias da cidade (OSM `office=estate_agent` com site), reconhece a plataforma
    e lê as que publicam schema.org pela extensão genérica (`extensions/agency.ts`, fonte `site:<host>`).
- `apps/api`: Fastify. `app.ts` monta (testes usam `app.inject`), `main.ts` escuta, `vercel.ts` é a mesma API como
  função da Vercel (empacotada por `scripts/build-vercel.mjs`), `env.ts` valida a configuração,
  `routes/` só valida e chama, `services/` orquestra fontes + domínio (`commute.ts`: rede de transporte da análise,
  na mesma cidade ou intermunicipal), `plugins/` (erros, streaming).
  Respostas longas (`/api/analyze`, `/api/listings`, `/api/links`) são **NDJSON** em streaming
  (`progress` / `warning` / `partial` / `result` / `error`).
- `apps/web`: React 18 + react-leaflet 4. Estrutura completa em [docs/arquitetura.md](docs/arquitetura.md#5-app-react).
  - `features/<assunto>/` (search, results, map, transit, links, favorites): `components/`, `hooks/`, `model/`
    (stores Zustand), `lib/` e um `index.ts` com a API pública. De fora, só `@/features/<assunto>`; dentro, caminho
    relativo. `app/` compõe a tela.
  - `shared/ui`: peças reutilizáveis sem regra de negócio (Modal, Switch, Segmented, Spinner, ExternalLink, Photo,
    Icon…), com CSS Modules. `shared/api`: cliente HTTP e leituras com TanStack Query. `shared/lib/persist.ts`:
    preferências no localStorage (chaves `mapa-aluguel:<nome>`, mantidas entre versões). `shared/` não importa features.
  - Camadas do mapa: um arquivo por camada em `features/map/layers/`, desenhadas de forma imperativa com `useLayer`,
    em canvas, por desempenho.
  - Alias `@/` = `apps/web/src` (Vite, tsconfig e Vitest).

## Regras

- **Parse puro e testado.** Toda extração de site fica numa função `(html|json) => dados` com teste e
  fixture real em `packages/sources/test/fixtures/`. O `search`/`resolve` só busca e chama o parse.
- **Toda chamada externa passa por `http.ts`** (`httpFetch`/`cached`): ritmo por host, novas tentativas e cache
  em `data/cache/` (na Vercel, também no Runtime Cache para o que vale 1 dia ou mais). Nominatim: no máximo 1 req/s e User-Agent do app (`APP_UA`).
- **Nada de contornar bloqueio.** Se um site exigir captcha/login ou bloquear, o raspador registra o aviso e
  segue com as outras fontes. Não adicionar plugins de "stealth" nem rotação de IP. Extensões leem só páginas
  públicas de busca (nada de API interna do site com Origin/Referer forjados) e o motor respeita o robots.txt.
- **Só rede pública:** `net.ts` confere a URL e o IP na conexão de toda chamada do `httpFetch` (links colados e
  sites vindos do OSM são de terceiros). Não chame `fetch` direto nem desligue o `publicDispatcher`.
- **Link de fora vira `href`/`src` só por `safeExternalUrl`** (domain): no app, `<ExternalLink>` e `<Photo>`.
  Texto de fora em HTML do Leaflet passa por `esc` (`features/map/lib/leaflet.ts`).
- No app e no domínio, `@homematch/contracts` só com `import type`; valores em `@homematch/contracts/constants`.
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
npm run build:vercel   # o que a Vercel roda a cada push na main (.vercel/output)
npm run preview:vercel # serve esse build no computador com os cabeçalhos da Vercel (API local em :3333)
```

Produção: projeto `home-match` na Vercel (https://home-match-delta.vercel.app), publica a cada push na `main`.
A pasta está ligada pela CLI (`.vercel/project.json`); no PowerShell use `vercel.cmd` (`vercel.cmd ls`,
`vercel.cmd logs <url>`, `vercel.cmd env ls`).
