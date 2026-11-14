# HomeMatch: arquitetura para produção

Objetivo: ter o HomeMatch no ar, funcionando no celular e no computador a qualquer hora, **sem custo**,
com uma base que aguente crescer (mais cidades, mais fontes, mais pessoas) sem reescrever tudo.

Decisões já tomadas:
- Favoritos ficam no navegador (sem login por enquanto).
- Uso pessoal no começo: dá para usar planos gratuitos que proíbem uso comercial (Vercel Hobby).

Este documento tem quatro partes: o que está hoje, os requisitos, a arquitetura alvo e as mudanças, em fases.

---

## 1. Como está hoje

| Parte | Hoje | Problema para produção |
|---|---|---|
| Estrutura | Um pacote só (`src/server`, `src/web`, `src/shared`), um `tsconfig` para tudo | Servidor enxerga tipos do DOM e o navegador os do Node; nada impede importar código do servidor no front |
| Tipos | `shared/types.ts` com 29 tipos de domínio, API e streaming misturados; validação zod só no servidor, escrita à mão em `index.ts` | O tipo e a validação podem divergir; o front não valida nada do que recebe |
| Servidor | `index.ts` com todas as rotas (236 linhas); análise pesada roda dentro da requisição | Uma análise longa trava o processo para todo mundo |
| Dados | Raspagem e consultas ao OSM **na hora da busca**; cache em arquivos (`data/cache`, 46 MB, sem limite) e em memória | Lento, sujeito a bloqueio; em container o disco some a cada deploy e cada instância tem o seu cache |
| Front | `App.tsx` com 476 linhas e 27 estados; componentes numa pasta só; um `styles.css` de ~580 linhas | Difícil de manter; botões, chips, modais e popovers repetidos com pequenas diferenças |
| Qualidade | Vitest (99 testes), `tsc` | Sem lint, sem CI, sem deploy automático, sem monitoramento |
| Execução | `tsx` (compila na hora), `listen` em `127.0.0.1` | Não roda em container nem atrás de proxy |

O que já está bom e fica: parse puro com fixture real, motor de fontes com extensões, robots.txt respeitado,
`http.ts` com ritmo por host, zod nas entradas, proteção contra SSRF nos links colados.

---

## 2. Requisitos

### 2.1 Funcionais (o que já existe e precisa continuar)
1. Escolher cidade e endereço do trabalho; achar as regiões que cabem no tempo de ônibus e têm o que a pessoa quer perto.
2. Listar imóveis de várias fontes com nota, grupos (atende tudo / essencial ok / quase lá / outras) e o que não bate.
3. Mapa configurável: nota das regiões, linhas uma a uma, lugares, imóveis, legenda.
4. Linhas de ônibus: popover, grade de horários do operador.
5. Favoritos no navegador, com filtro Todos/Favoritos.
6. "Meus links": colar anúncio de qualquer site e ver no mapa.
7. Descoberta das imobiliárias da cidade.

### 2.2 Novos para produção
8. **Instalar no celular** (PWA): ícone na tela inicial, abre em tela cheia, funciona com conexão ruim (favoritos e última busca offline).
9. **Imóveis sempre prontos**: a lista vem do banco em menos de 1 s; a coleta acontece antes, em segundo plano.
10. **Frescor visível**: cada anúncio mostra quando foi visto pela última vez; anúncio que sumiu da fonte sai da lista.
11. **Atualizar agora** (opcional): pedir uma coleta da cidade fora do horário, com limite de frequência.
12. **Acesso restrito** enquanto for pessoal: só quem tem a chave usa a API (evita que alguém use o servidor para raspar em massa).
13. **Exportar/importar favoritos** (JSON), já que ficam por aparelho.

### 2.3 Não funcionais

| Item | Meta |
|---|---|
| Custo | R$ 0/mês nos planos gratuitos |
| Latência | Lista de imóveis p95 < 500 ms; análise em cache < 2 s; análise nova < 20 s com progresso |
| Disponibilidade | Melhor esforço; acordar do zero (cold start) em até ~10 s é aceitável |
| Celular | Layout mobile primeiro; Lighthouse PWA e acessibilidade ≥ 90 |
| Segurança | HTTPS; chave de acesso; limite por IP; cabeçalhos de segurança (CSP); validação de toda entrada; SSRF bloqueado |
| Respeito às fontes | robots.txt, ritmo por host, cache, sem contornar bloqueio, só páginas públicas (já é regra do projeto) |
| Privacidade (LGPD) | Nenhum dado pessoal no servidor (favoritos e endereço do trabalho ficam no aparelho; o endereço só passa pela API na hora da análise e não é guardado) |
| Observabilidade | Logs estruturados, erros no Sentry, alerta quando uma coleta ou parser falhar |
| Manutenção | Lint + typecheck + testes no CI; deploy automático a cada push na `main` |

---

## 3. Arquitetura alvo

### 3.1 Visão geral

```
 Celular / Desktop (PWA React)
   favoritos, configurações e última busca no localStorage
        │ HTTPS
 Vercel (estático + CDN) ── /api/* ──►  API (Fastify, container, Cloud Run)
                                         • rotas finas: valida (zod) → serviço → resposta
                                         • análise em worker thread (não trava o processo)
                                         • só lê do banco; nunca raspa na requisição
                                              │
                                    Postgres + PostGIS (Neon)
                                    imóveis, histórico de preço, rede de ônibus,
                                    lugares, bairros, fontes, cache, execuções de jobs
                                              ▲
 Jobs agendados (GitHub Actions cron → `worker`)
   • coletar imóveis por cidade (a cada 6–12 h)      • rede de ônibus e horários (1x/dia)
   • lugares e bairros do OSM (1x/semana)            • descoberta de imobiliárias (1x/semana)
   • teste dos parsers contra o site real (1x/dia) → abre issue/alerta se quebrar
```

Princípio central: **coletar ≠ buscar**. A coleta roda em segundo plano, no ritmo de cada site, e grava no banco.
A busca só consulta o banco. Isso resolve latência, bloqueio, custo e escala de uma vez.

### 3.2 Onde hospedar (gratuito)

| Peça | Escolha | Por quê | Alternativa |
|---|---|---|---|
| Front (React) | **Vercel Hobby** | Deploy a cada push, preview por PR, CDN, HTTPS. Hobby é só uso pessoal/não comercial (é o caso agora) | Cloudflare Pages, Netlify |
| API | **Google Cloud Run** | Container, escala a zero, cota gratuita mensal generosa, timeout de requisição longo (bom para NDJSON) | Render free (dorme após 15 min sem uso, ~1 min para acordar, disco efêmero) |
| Banco | **Neon Free** (Postgres + PostGIS, 1 GB por projeto) | Postgres de verdade com geografia; suficiente para algumas cidades | Supabase Free |
| Jobs | **GitHub Actions** (cron) rodando `npm run worker -- <job>` | Já está no GitHub; 2.000 min/mês em repositório privado | Cloud Run Jobs + Cloud Scheduler |
| Mapa (tiles) | Provedor com plano gratuito com chave (MapTiler/Stadia) ou **Protomaps** (arquivo PMTiles no Cloudflare R2) | `tile.openstreetmap.org` não permite uso em app | — |
| Erros | Sentry (plano gratuito) | Erros do front e da API num lugar só | — |

Por que não colocar a API na Vercel também: funções têm limite de duração (5 min no Hobby), sobem a frio
a cada pouco tempo e não guardam a rede de ônibus em memória entre chamadas. A análise e o streaming
ficam mais estáveis num container. Se um dia a análise ficar toda pré-calculada, dá para mover.

Como o front fala com a API: `vercel.json` com `rewrites` de `/api/:path*` para a URL do Cloud Run
(mesma origem, sem CORS). Se o streaming NDJSON chegar em bloco pelo proxy, o front chama a API direto
(`VITE_API_URL`) com CORS liberado só para o domínio do app.

### 3.3 Organização do código (monorepo com npm workspaces)

```
homematch/
├─ apps/
│  ├─ web/          React + Vite + PWA (só UI e estado do navegador)
│  ├─ api/          Fastify: rotas → serviços → repositórios
│  └─ worker/       CLI dos jobs (coleta, rede, OSM, descoberta, teste dos parsers)
├─ packages/
│  ├─ contracts/    schemas zod da API → tipos TypeScript (fonte única da verdade)
│  ├─ domain/       regras puras: filtros, nota, "o que não bate", grupos, geo, horários
│  ├─ sources/      motor de coleta + extensões de sites + operadores de ônibus + clientes OSM
│  ├─ db/           esquema e migrações (Drizzle), repositórios
│  └─ config/       tsconfig base, ESLint, Prettier
└─ docs/
```

Regra de dependência (verificada pelo ESLint, `import/no-restricted-paths`):

```
web ──► contracts, domain
api ──► contracts, domain, db, sources(só leitura de horários/links)
worker ──► domain, db, sources
domain ──► (nada)        contracts ──► zod
```

`domain` é puro (sem rede, sem banco, sem React): roda igual no navegador, na API e nos testes. Hoje
essas regras estão espalhadas em `web/search.ts`, `shared/filters.ts`, `web/lines.ts`, `web/mapSettings.ts`,
`server/analysis.ts` (parte pura) e `server/geo.ts`.

### 3.4 Tipos TypeScript

1. **Contratos a partir do zod** (`packages/contracts`):
   ```ts
   export const ListingSchema = z.object({ id: ListingId, source: SourceId, total: z.number(), /* … */ });
   export type Listing = z.infer<typeof ListingSchema>;
   export const SearchListingsRequest = z.object({ cityId: CityId, regions: z.array(RegionRef).max(15), filters: ListingFilters });
   ```
   A API valida a entrada com o mesmo schema que gera o tipo; o front usa o tipo e, em desenvolvimento,
   valida a resposta. Acaba a duplicação entre `shared/types.ts` e os `z.object` de `server/index.ts`.
2. **Um arquivo por assunto**: `listing.ts`, `city.ts`, `transit.ts`, `analysis.ts`, `sources.ts`, `stream.ts`, `index.ts` reexporta.
3. **Ids com marca** (branded), para não trocar um pelo outro: `ListingId`, `SourceId`, `LineKey`, `CityId` (`z.string().brand<"ListingId">()`).
4. **Uniões discriminadas** onde hoje há strings soltas: status de fonte, eventos do stream, "o que não bate" (`Miss`).
5. **Tipos de domínio ≠ tipos de banco ≠ tipos de API**: o repositório converte a linha do banco em tipo de domínio; a rota converte domínio em resposta. Mudar o banco não quebra o front.
6. `tsconfig` base mais estrito (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`) e um `tsconfig` por app (web com DOM, api/worker com Node).
7. API versionada: `/api/v1/...`. Mudança que quebra vira `v2` enquanto o front antigo ainda estiver em cache no celular (PWA).

### 3.5 API (camadas)

```
apps/api/src/
├─ main.ts                 sobe o Fastify (0.0.0.0, PORT do ambiente), plugins, rotas
├─ env.ts                  variáveis de ambiente validadas com zod (falha ao subir se faltar algo)
├─ plugins/                auth (chave de acesso), rate-limit, helmet/CSP, cors, sentry, errors
├─ routes/                 cities, analyses, listings, sources, transit, links, health  (só HTTP)
├─ services/               casos de uso: analyzeRegions, searchListings, getTimetable, resolveLink
└─ workers/analysis.ts     análise em worker thread (Piscina), com a rede da cidade carregada uma vez
```

Endpoints alvo:

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/v1/cities?q=` / `/api/v1/cities/:id` | Busca e limites da cidade (com cache no banco) |
| POST | `/api/v1/analyses` | Regiões para (cidade, trabalho, parâmetros). NDJSON com progresso; cache por (cidade, trabalho arredondado a ~200 m, parâmetros) |
| POST | `/api/v1/listings/search` | Imóveis do banco nas regiões, com filtros largos; resposta JSON paginada |
| GET | `/api/v1/sources?cityId=` | Fontes e imobiliárias da cidade (do banco, preenchido pelo job de descoberta) |
| POST | `/api/v1/cities/:id/refresh` | Pede coleta agora (limite: 1 a cada 30 min por cidade) |
| GET | `/api/v1/transit/lines?cityId=&q=` / `…/lines/:key/timetable` | Linhas e horários |
| POST | `/api/v1/links/resolve` | "Meus links" (continua lendo a página na hora, com SSRF bloqueado) |
| GET | `/api/v1/health` | Saúde + versão + idade da última coleta por cidade |

### 3.6 Banco (Postgres + PostGIS)

| Tabela | Conteúdo | Índices |
|---|---|---|
| `cities` | id OSM, nome, UF, bbox, limite (`geometry`), operador de ônibus | GIST(limite) |
| `sources` | portal ou imobiliária, cidade, status (ok/robots/bloqueado/sem-dados), plataforma, última verificação | (city_id) |
| `listings` | id `fonte:id`, fonte, cidade, URL, tipo, aluguel, condomínio, IPTU, total, área, quartos, banheiros, vagas, comodidades `text[]`, bairro, endereço, `geom point`, aproximado, foto, imobiliária, `first_seen`, `last_seen`, `active` | GIST(geom), (city_id, active, total), (source_id) |
| `listing_prices` | histórico de preço (listing_id, visto_em, total) | (listing_id, visto_em) |
| `transit_routes` / `transit_stops` | rede por operador: linha, sentido, traçado, paradas em ordem | GIST, (operator, ref) |
| `timetables` | grade por linha (JSON) e quando foi lida | (operator, ref) |
| `pois` / `places` | mercados, parques… e nomes de bairros, do extrato OSM | GIST(geom), (city_id, feature) |
| `analysis_cache` | resultado da análise por chave (cidade, trabalho, parâmetros) | (key), expira em 7 dias |
| `job_runs` | job, cidade, início, fim, status, números, erro | (job, city_id, started_at) |

1 GB do Neon comporta folgado algumas cidades (um imóvel ≈ 1 KB; 50 mil imóveis ≈ 50 MB).
O cache em arquivos (`data/cache`) deixa de existir em produção: o que é dado vai para tabelas; o que é
só memória de requisição vira LRU em memória com limite.

### 3.7 Jobs (worker)

| Job | Quando | O que faz |
|---|---|---|
| `ingest-listings --city` | a cada 6–12 h por cidade ativa | roda o motor de fontes para as regiões da cidade (bairros), faz upsert em `listings`, grava histórico de preço, marca `active=false` o que não apareceu em 2 coletas |
| `transit-network --operator` | 1x/dia | baixa a rede (EMDEC) para `transit_routes/stops` |
| `timetables --operator` | 1x/dia | grades das linhas usadas |
| `osm-extract --city` | 1x/semana | lugares (mercados, parques…) e bairros a partir do extrato OSM do estado (Geofabrik), sem depender do Overpass público |
| `discover-agencies --city` | 1x/semana | imobiliárias da cidade e se dá para ler |
| `parser-canary` | 1x/dia | baixa 1 página real de cada fonte e roda o parse; se vier vazio ou quebrar, abre uma issue no GitHub |

Cada job: idempotente, registra em `job_runs`, respeita robots.txt e ritmo (o motor atual já faz isso),
e termina com código de erro se falhar (o GitHub Actions avisa por e-mail).

### 3.8 Front (React)

```
apps/web/src/
├─ app/            App (só layout), providers (QueryClient, tema), rotas se houver
├─ features/
│  ├─ search/      SetupWizard, FilterBar, store da busca, useAnalysis (stream)
│  ├─ results/     ResultsPanel, ListingCard, TierSection, EmptyState de resultados
│  ├─ listing/     ListingDetail, PreviewCard
│  ├─ map/         MapView e camadas (Cells, Pois, Routes, Listings), MapSettingsPanel, Legend
│  ├─ transit/     LinePopover, TimetableModal, linhas (summarize, horários)
│  ├─ favorites/   store (persistida), FavButton, FavoritesList, exportar/importar
│  ├─ sources/     SourcesPicker
│  └─ links/       LinksPanel
├─ shared/
│  ├─ ui/          Button, IconButton, Chip, Segmented, Switch, Pill, Badge, Card, Modal,
│  │               Popover, EmptyState, Spinner, Alert, Field, MoneyInput, Icon
│  ├─ api/         cliente HTTP tipado (contracts) + leitor de NDJSON
│  ├─ lib/         format, storage seguro (try/catch), datas
│  └─ styles/      tokens.css (cores, espaços, raios, sombras, tipografia), reset
└─ main.tsx
```

- **Estado**: tirar os 27 `useState` do `App` para stores por feature (Zustand com `persist` para o que vai ao localStorage: favoritos, configurações do mapa, filtros). O `App` só monta o layout.
- **Dados do servidor**: TanStack Query (cache, novas tentativas, carregando/erro iguais em toda tela). O stream da análise vira um hook próprio.
- **Componentes reutilizáveis** (`shared/ui`): hoje há o mesmo padrão escrito várias vezes (chips em FilterBar, SetupWizard e MapSettingsPanel; modal no detalhe e na grade de horários; popovers; interruptores). Cada primitivo tem variantes por prop (`<Button variant="primary" size="sm">`), acessibilidade embutida (foco, Esc, `aria-*`) e um teste.
- **Estilos**: os tokens que já existem em `:root` viram `tokens.css`; cada componente tem seu CSS Module ao lado (`Button.module.css`). O `styles.css` único some aos poucos.
- **PWA**: `vite-plugin-pwa` com manifest, ícones, service worker (cache do app shell e dos tiles vistos), tela de "sem conexão" que ainda mostra os favoritos.
- **Testes de UI**: Testing Library para os componentes de `shared/ui` e os fluxos principais (favoritar, filtro Todos/Favoritos, ligar/desligar linha).

### 3.9 Segurança

- Chave de acesso: `APP_ACCESS_KEY` no servidor; o app pede uma vez e guarda no aparelho; a API recusa sem ela (exceto `/health`). Simples, sem login, suficiente para uso pessoal.
- `@fastify/rate-limit` por IP (ex.: 60 req/min; análise e "atualizar agora" bem mais baixo).
- `@fastify/helmet` com CSP (só os domínios de tiles, imagens dos portais e a API).
- Links colados: manter `assertPublicUrl` (sem rede local) e limitar tamanho da página.
- Segredos só em variáveis de ambiente (Vercel, Cloud Run, GitHub Actions secrets); nada no repositório.

---

## 4. Mudanças, em fases

Cada fase deixa o app funcionando. As fases 1 e 2 dá para fazer ainda rodando local.

### Fase 1: organizar a base (sem mudar o que o usuário vê)
- [x] Monorepo com npm workspaces (`apps/web`, `apps/api`, `packages/*`), movendo os arquivos atuais.
      `apps/worker` nasce na fase 2, junto com os jobs (antes disso não teria o que rodar)
- [x] `tsconfig` base estrito (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`…) + um por pacote; ESLint com as
      setas entre pacotes (`no-restricted-imports`) + Prettier
- [x] `packages/contracts`: schemas zod por assunto (geo, place, features, transit, analysis, listings, stream) e os
      tipos com `z.infer`; a API valida com os mesmos schemas. Ids com marca ficaram para depois: hoje os ids são
      montados em muitos pontos (`site:<host>`, `emdec:353:1`) e a marca pediria conversão em todos; os formatos
      que importam são validados por regex no contrato (`osmIdSchema`, `timetableIdSchema`)
- [x] `packages/domain`: geo, modelo de trajeto, grade e nota das regiões, filtros, "o que não bate", grupos,
      diagnóstico, linhas e horários, com os testes
- [x] `packages/sources`: motor, extensões, EMDEC, clientes OSM, links; cache em `DATA_DIR` (não depende mais da pasta
      de onde o app sobe)
- [x] API em camadas (`app.ts`, `main.ts`, `env.ts`, `routes/`, `services/`, `plugins/`), com testes por `app.inject`.
      Análise em worker thread fica para a fase 2: hoje quase todo o tempo dela é rede (Overpass, EMDEC); com os
      dados no banco o cálculo vira a parte pesada e aí compensa tirar da thread principal
- [x] Front por features (`search`, `results`, `favorites`, `map`, `transit`, `links`); `shared/ui` (Modal, Switch,
      Segmented, Spinner, CloseButton, ErrorAlert, Icon, Photo); stores Zustand no lugar dos 27 `useState` do `App.tsx`
      (mesmas chaves do localStorage: ninguém perde favoritos); TanStack Query para as leituras simples (características,
      fontes, operador, horários); tokens em `styles/tokens.css` e CSS Modules nos primitivos. O CSS das telas segue em
      `styles/app.css` e vai para módulos junto de cada componente quando ele for mexido
- [x] CI no GitHub Actions (`.github/workflows/ci.yml`): formatação, lint, typecheck, testes e build em todo push/PR

### Fase 2: dados no banco
- [ ] Neon + PostGIS; Drizzle com migrações versionadas; repositórios em `packages/db`
- [ ] Worker com os jobs da seção 3.7, chamáveis pela linha de comando
- [ ] `/listings/search` lendo do banco; tirar a raspagem do caminho da requisição
- [ ] `/sources` lendo do banco; descoberta vira job
- [ ] Rede de ônibus, horários, lugares e bairros vindos do banco (não mais do Overpass/EMDEC na hora)
- [ ] Cache da análise no banco; `data/cache` só em desenvolvimento
- [ ] Na tela: "visto há 3 h" no card e botão "Atualizar agora"

### Fase 3: no ar
- [ ] API: `listen` em `0.0.0.0` e `PORT`; build compilado (esbuild/tsup) e `node dist/main.js`; Dockerfile multi-stage
- [ ] Cloud Run com mínimo 0 instâncias, variáveis de ambiente e segredos. Região: a cota gratuita é calculada
      sobre o preço de `us-central1`; São Paulo (`southamerica-east1`) responde mais rápido daqui, mas o preço por região
      muda, então conferir a página de preços antes e pôr um alerta de orçamento de R$ 1 na conta
- [ ] Vercel: projeto apontando para `apps/web`, `vercel.json` com rewrite de `/api` (ou `VITE_API_URL` + CORS)
- [ ] Chave de acesso, rate limit, helmet/CSP, Sentry no front e na API
- [ ] Provedor de tiles com chave (ou Protomaps no R2) e atribuição do OSM no mapa
- [ ] PWA (manifest, ícones, service worker, tela offline); exportar/importar favoritos
- [ ] GitHub Actions: deploy da API a cada push na `main`; workflows agendados dos jobs; segredos configurados
- [ ] Domínio (opcional): `homematch.vercel.app` já serve

### Fase 4: depois (quando precisar)
- [ ] Tempo de ônibus real: OpenTripPlanner/R5 com GTFS (se o operador publicar)
- [ ] Feeds XML das imobiliárias (formato dos portais), com autorização, como fonte principal
- [ ] Mais cidades com operador de ônibus cadastrado
- [ ] Login só se for preciso sincronizar favoritos entre aparelhos
- [ ] Sair do plano Hobby da Vercel se virar produto (uso comercial exige plano pago)

### Riscos e como lidar

| Risco | Mitigação |
|---|---|
| Portais bloqueiam IPs de nuvem (já acontece com ZAP/VivaReal/OLX) | Fontes ficam como "bloqueado" e o app segue com as outras; priorizar Chaves na Mão, Lopes, imobiliárias e, no futuro, feeds |
| Site muda o HTML e o parser para de achar anúncios | `parser-canary` diário abre issue; atualizar fixture e parse (regra do projeto) |
| Limites gratuitos mudarem | Tudo roda em container/Postgres padrão: dá para trocar de provedor sem mudar código |
| Banco passar de 1 GB | Apagar imóveis inativos há mais de 60 dias e o histórico antigo; ou subir de plano |
| Cold start do Cloud Run | Rede da cidade em cache no banco e carregada sob demanda; aceitável para uso pessoal |
