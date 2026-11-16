# HomeMatch: arquitetura

O HomeMatch é uma aplicação 100% web: um app React que consome a API do próprio projeto. **Não há banco de dados.**
O que é da pessoa (favoritos, filtros, linhas, última busca) fica no `localStorage` do navegador; a API lê as fontes
públicas na hora, com cache.

## 1. Princípios

- **Sem banco de dados e sem login.** Preferências e favoritos ficam no aparelho (`localStorage`, chaves
  `mapa-aluguel:<nome>`). O servidor não guarda nada que precise sobreviver a um deploy.
- **Custo zero.** Tudo num projeto da Vercel (plano Hobby, uso pessoal e não comercial), ligado ao GitHub: cada push
  na `main` publica.
- **Respeito às fontes.** robots.txt, ritmo por host, cache, sem contornar bloqueio, só páginas públicas.
- **Privacidade.** O endereço do trabalho só passa pela API durante a análise e não é guardado.

## 2. Visão geral

```
 Navegador (React + Leaflet)
   favoritos, filtros, linhas e última busca no localStorage
        │ HTTPS, mesma origem
 Vercel
   ├─ CDN: app estático (apps/web/dist)
   └─ /api/*: função Node em São Paulo (gru1) = a API Fastify (apps/api)
          │  cache em dois níveis: /tmp da instância + Runtime Cache da Vercel
          ▼
   Fontes públicas: Nominatim, Overpass (OpenStreetMap), EMDEC, portais e sites de imobiliárias
```

## 3. Monorepo

npm workspaces:

```
apps/
  web/          React 18 + Vite: só interface e estado do navegador
  api/          Fastify: rotas finas → serviços → fontes e domínio
packages/
  contracts/    schemas zod da API e os tipos derivados (uma fonte só); constantes sem zod em /constants
  domain/       regras puras: geo, trajeto, grade e nota, filtros, "o que não bate", linhas e horários
  sources/      tudo que vem de fora: http.ts (ritmo, cache, guarda de rede), OSM, operadores, anúncios, links
docs/
scripts/        build da Vercel e atalho para rodar no computador
```

Quem pode importar quem (o ESLint barra o resto):

```
web ──► contracts (só tipos e /constants), domain
api ──► contracts, domain, sources
sources ──► contracts, domain
domain ──► contracts (só tipos e /constants)
contracts ──► zod
```

`domain` não usa rede, disco, React nem zod: roda igual na API, no navegador e nos testes.

## 4. API

```
apps/api/src/
├─ app.ts        monta o Fastify (os testes usam app.inject)
├─ main.ts       escuta numa porta (uso local)
├─ vercel.ts     a mesma API como função da Vercel
├─ env.ts        configuração validada com zod
├─ plugins/      erros (status certos) e streaming NDJSON
├─ routes/       só validam a entrada (contracts) e chamam o serviço
└─ services/     análise das regiões (analysis, commute) e leitura dos links
```

### Níveis das regiões (sem tempo máximo)

Não há tempo máximo até o trabalho. A grade (`domain/analysis/grid.ts`) cobre a cidade inteira e cada área é
julgada pelos critérios da pessoa (`domain/analysis/levels.ts`): transporte até o trabalho e cada lugar pedido,
com peso 3 (principal), 2 (importante) ou 1 (bom ter).

- **Excelente**: a principal foi atingida e pelo menos 75% do peso também. **Boa**: a principal. **Ok**: outra
  coisa, mas não a principal. Nada atingido: a área fica de fora (e os imóveis dela não aparecem).
- **Transporte atingido**: tempo até o trabalho até `commuteRef` (o melhor da cidade × 1,5, no mínimo 40 min) ou um
  ponto de uma linha escolhida pela pessoa a uma caminhada. Assim, morando na cidade vizinha, as áreas mais bem
  servidas ainda contam.
- **Lugar atingido**: o mais próximo dentro do raio pedido.
- A nota (0–100) soma os pesos atingidos, cada um pelo quão bem foi atingido, e ordena dentro do mesmo nível.

No app, o nível mínimo ("Todas", "Boa ou melhor", "Só excelentes") vale para o mapa, a lista de regiões e os imóveis.

### Trabalho em outra cidade

Quando o trabalho fica fora do município escolhido (`services/commute.ts`):

1. A cidade do trabalho sai do Nominatim (`cityAt`, com o limite municipal).
2. **Primeiro, as linhas que passam perto do trabalho** (rede da cidade do trabalho: o operador oficial, como a EMDEC,
   ou o OSM). Elas vão sempre ao mapa e aparecem no topo da lista de linhas ("passa perto do trabalho").
3. Uma consulta ao Overpass (`sources/intercity.ts`) traz as **linhas intermunicipais**: as relações de ônibus, trem
   ou metrô que param nas duas cidades (conferido pelo limite, porque as bboxes de cidades vizinhas se sobrepõem),
   os pontos de ônibus da cidade de casa e os terminais/rodoviárias da cidade do trabalho. Para ser leve, ela pega
   as linhas que param na cidade de casa e filtra pela bbox da cidade do trabalho (`rel.ra(bbox)`); quem para mesmo
   lá é conferido no parse, pelo limite municipal.
4. A rede da cidade do trabalho entra para a baldeação no destino: o operador oficial quando há (EMDEC em Campinas),
   senão as linhas do OSM perto do trabalho. O cálculo é o de sempre (`boardingStops` com uma baldeação).
5. Com poucas intermunicipais mapeadas saindo da cidade de casa, entra a estimativa por terminal (`domain/transit/
   intercity.ts`): ponto perto de casa → terminal da cidade do trabalho por rodovia → linha municipal (ou a pé) até o
   trabalho, escolhendo o terminal com o menor tempo. No mapa, esse trecho aparece pontilhado
   (`TransitRoute.estimated`), junto com a linha municipal real.

Linhas metropolitanas sem dado aberto (a EMTU/Artesp fica atrás de bloqueio anti-robô e não publica GTFS aberto)
dependem do OpenStreetMap; onde ninguém mapeou, vale a estimativa.

As buscas de linha do app (`/api/bus`, `/api/bus/near`, `/api/transit/operator`) recebem também o trabalho
(`wlat`, `wlng`): morando em Paulínia e trabalhando em Campinas, a linha 353 e as "linhas perto do trabalho" vêm da
EMDEC. Cada linha da análise tem um papel (`TransitRoute.kind`): `nearWork`, `intercity`, `estimated` ou `feeder`
(baldeação), e a lista do mapa segue essa ordem.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/health` | Saúde |
| GET | `/api/cities?q=` · `/api/city/:osmId` | Busca de cidade e limites (Nominatim) |
| GET | `/api/geocode?q=` · `/api/reverse?lat=&lng=` | Endereço do trabalho |
| GET | `/api/features` | Características que dá para pedir (mercado, parque…) |
| GET | `/api/sources?cityId=` | Portais e imobiliárias da cidade, e se dá para ler cada uma |
| POST | `/api/analyze` | Regiões que cabem no trajeto e têm o que a pessoa quer perto (NDJSON) |
| POST | `/api/listings` | Imóveis nas regiões escolhidas (NDJSON) |
| POST | `/api/links` | "Meus links": anúncios colados no mapa (NDJSON) |
| GET | `/api/transit/operator` · `/api/bus` · `/api/bus/near` · `/api/bus/timetable` | Linhas de ônibus e horários |

Respostas longas saem em **NDJSON** (`progress` / `warning` / `partial` / `result` / `error`): a tela mostra o
andamento de buscas que levam minutos.

## 5. App React

Organizado por funcionalidade. Cada pasta de `features/` é uma fatia vertical (tela, estado e hooks daquele
assunto) e só é usada por fora pelo seu `index.ts`.

```
apps/web/src/
├─ main.tsx              ponto de entrada (estilos globais, Providers, App)
├─ app/                  composição da tela
│  ├─ App.tsx            layout: barra do topo, painel, mapa e o que abre por cima
│  ├─ Providers.tsx      QueryClient (TanStack Query)
│  ├─ TopBar.tsx
│  └─ shell.ts           modo (explorar/links) e abertura da configuração
├─ features/
│  ├─ search/            cidade, trabalho, critérios e fontes
│  │  ├─ components/     SetupWizard, FilterBar, SearchBox, SourcesPicker
│  │  ├─ hooks/          useSearch (análise e imóveis em streaming)
│  │  ├─ model/          stores: search (critérios), place (cidade e trabalho)
│  │  └─ index.ts        API pública
│  ├─ results/           lista, detalhe e prévia dos imóveis (components/, hooks/useRanked)
│  ├─ map/               mapa
│  │  ├─ components/     MapView, Legend, MapSettingsPanel
│  │  ├─ layers/         uma camada por arquivo (Cells, Pois, Routes, BusLines, ListingMarkers…)
│  │  ├─ hooks/          useLayer (camada imperativa em canvas)
│  │  ├─ lib/            utilitários do Leaflet (escape de HTML, destaque de linha)
│  │  ├─ model/          stores: settings (camadas visíveis), view (área visível)
│  │  └─ types.ts
│  ├─ transit/           linhas de ônibus: popover, grade de horários, store das linhas
│  ├─ links/             "Meus links": painel e store
│  └─ favorites/         store dos favoritos
├─ shared/               genérico, sem regra de negócio e sem saber das features
│  ├─ ui/                Modal, Switch, Segmented, Spinner, ExternalLink, Photo, Icon… (CSS Modules)
│  ├─ api/               cliente HTTP tipado, leitor de NDJSON, leituras com TanStack Query
│  ├─ hooks/             useEscape
│  └─ lib/               persist (localStorage), format
└─ styles/               tokens.css (cores, espaços, tipografia) e app.css
```

Regras (verificadas pelo ESLint em `eslint.config.js`):

- **API pública por funcionalidade:** de fora, `import { MapView } from "@/features/map"`; nunca
  `@/features/map/components/MapView`.
- **Dentro da funcionalidade, caminho relativo**; fora dela, o alias `@/` (`@/shared/ui`, `@/features/x`).
- **`shared/` não depende de `features/` nem de `app/`**, e as funcionalidades não dependem de `app/`.
- **Contratos só como tipo no navegador:** `import type` de `@homematch/contracts`; valores em
  `@homematch/contracts/constants`. Assim o zod não vai para o pacote do app.
- **Estado:** um store Zustand por assunto em `model/`; o que vai ao `localStorage` passa por `shared/lib/persist.ts`
  (as chaves não mudam entre versões: ninguém perde favoritos). Leituras da API com TanStack Query.
- **Links externos** só com `<ExternalLink>` (aceita apenas `http(s)`); fotos com `<Photo>`.
- **Camadas grandes do mapa** (células, lugares, linhas) desenhadas de forma imperativa com `useLayer`, em canvas.

Nova funcionalidade: crie `features/<nome>/` com as subpastas de que precisar (`components/`, `hooks/`, `model/`,
`lib/`) e um `index.ts` exportando só o que outras partes usam.

## 6. Cache

Toda chamada externa passa por `packages/sources/src/http.ts`:

1. **Disco local** (`data/cache/` no computador, `/tmp/homematch` na Vercel), por namespace e validade
   (OSM 7 dias, endereços 30 dias, anúncios 6 h).
2. **Runtime Cache da Vercel** (`useSharedCache`, ligado em `vercel.ts`) para o que vale 1 dia ou mais (OSM,
   endereços, rede de ônibus), compactado, até 2 MB por item. É cache, não banco: se falhar ou a cota acabar,
   o app segue mais devagar. Anúncios ficam só no disco local.

**Fonte fora do ar:** se a consulta falha (Overpass lotado, site fora do ar), o cache devolve o valor vencido que
tiver (o compartilhado guarda 4× a validade) em vez de derrubar a busca. O Overpass tenta 5 servidores (incluindo as
duas máquinas do overpass-api.de, `lz4` e `z`, com filas próprias) e, se todos estiverem lotados, dá mais uma volta
depois de alguns segundos. Na análise, cada parte que ainda assim falhar (um tipo de lugar, as linhas perto do
trabalho, os nomes dos bairros) vira aviso e o resto segue.

**Nomes das regiões:** pontos de bairro do OSM e, numa segunda consulta, áreas com nome (bairro oficial como limite
administrativo, loteamento/residencial, vila). Sem bairro a 2,5 km, vale o mais próximo até 6 km; sem nenhum, a
cidade e a zona ("Paulínia, zona norte"). Nunca coordenadas: o nome também é usado na busca dos portais.

As consultas ao OpenStreetMap pedem a cidade inteira (não o recorte em volta do trabalho): a mesma resposta serve a
qualquer busca na cidade e o cache acerta quase sempre.

## 7. Segurança

- **Rede (SSRF):** `packages/sources/src/net.ts`. Toda chamada do servidor só fala com endereços públicos: o texto
  da URL é conferido e o IP é conferido na hora da conexão (agente do undici com `lookup` próprio), o que barra
  DNS rebinding. Vale para links colados, sites de imobiliárias e de operadores vindos do OpenStreetMap e cada
  redirecionamento.
- **Links colados:** só `http(s)`, até 5 redirecionamentos, página de até 5 MB e só HTML/texto.
- **XSS:** `safeExternalUrl` (domain) filtra links de fora antes de virarem `href`/`src`; o app usa
  `<ExternalLink>` e `<Photo>`. Tooltips do Leaflet escapam todo texto de fora. CSP só com scripts do próprio app.
- **Cabeçalhos** (em `scripts/build-vercel.mjs`): CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS.
- **Entradas:** zod em toda rota, coordenadas e textos com limites, corpo de até 2 MB.
- **Overpass:** texto do usuário entra nas consultas sempre escapado.
- **Dependências:** `npm audit` (produção, nível alto) no CI.

## 8. Deploy na Vercel

A Vercel roda `npm ci` e `npm run build:vercel` a cada push na `main`. O script `scripts/build-vercel.mjs` monta
`.vercel/output` (Build Output API), que a Vercel publica como está: `static/` na CDN e `functions/api.func` (a API
inteira num arquivo, via esbuild) atendendo `/api/*`, com streaming, `maxDuration` de 300 s e região `gru1`.

Limites do plano Hobby que importam: cada chamada da API pode durar até 5 minutos (análise e busca de imóveis cabem);
o disco da função só aceita escrita em `/tmp` e some quando a instância é desligada (daí o segundo nível de cache).

Para rodar fora da Vercel, a API é um Fastify comum (`main.ts` escuta numa porta, `npm run app` entrega o app junto).

## 9. Próximos passos

- [ ] Testar no celular (layout em tela pequena) e corrigir o que aparecer
- [ ] PWA: manifest e ícones para "Adicionar à tela inicial"
- [ ] Exportar/importar favoritos em JSON (o `localStorage` é por aparelho: é o jeito de levar do computador para o
      celular)
- [ ] Quebrar os componentes grandes (`ResultsPanel`, `SetupWizard`, `ListingDetail`) em peças menores e levar o CSS
      de cada um de `styles/app.css` para um CSS Module ao lado
- [ ] Limite de pedidos por IP (Vercel Firewall) se o endereço deixar de ser só de quem mantém o projeto
- [ ] Provedor de tiles com chave (MapTiler/Stadia) se o uso crescer: `tile.openstreetmap.org` tolera uso leve
- [ ] Tempo de ônibus real com GTFS (se o operador publicar) e mais cidades com operador cadastrado

## 10. Riscos

| Risco | Como lidar |
|---|---|
| Portais bloqueiam IPs de nuvem (já acontece com ZAP/VivaReal/OLX) | A fonte aparece como "bloqueada" e o app segue com as outras |
| Site muda o HTML e o parser para de achar anúncios | O aviso aparece na busca; atualizar fixture e parse |
| Overpass público lento ou fora do ar | Cache em dois níveis e servidores alternativos em `osm/overpass.ts` |
| Limites gratuitos mudarem | A API é um Fastify comum: dá para levar para outro serviço sem mudar o código |
| Função "fria" na Vercel | A primeira chamada depois de um tempo parado leva alguns segundos a mais |
