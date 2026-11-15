# HomeMatch

Aplicação web (React + mapa) para achar aluguel com base no **trabalho**, no **transporte público** e no que você
quer ter **perto de casa**. Sem banco de dados e sem login: favoritos e preferências ficam no navegador.

Código aberto para uso **não comercial** ([PolyForm Noncommercial 1.0.0](LICENSE)).

Dois modos:

**🔎 Explorar regiões**

1. Escolha a **cidade** e marque o **trabalho** (endereço ou clique no mapa).
2. Escolha o que precisa por perto (mercado grande/atacarejo, parque, academia, farmácia…) e o raio de cada um, e
   **o que é mais importante**: transporte até o trabalho e cada lugar como *principal*, *importante* ou *bom ter*
   (sem carro, transporte como principal; com carro, "não uso").
3. **Analisar a cidade** (sem tempo máximo):
   - busca as linhas de ônibus, metrô e trem que chegam ao trabalho (operador oficial ou OpenStreetMap; se o trabalho
     é em outra cidade, as intermunicipais e a baldeação no destino);
   - divide a cidade numa grade (500 m) e estima o tempo de cada pedaço até o trabalho
     (caminhada até a parada + espera + viagem + caminhada final);
   - dá a cada área um **nível**: *excelente* (a prioridade principal e quase todo o resto), *boa* (a principal) ou
     *ok* (outra coisa, mas não a principal). O transporte conta como atingido até o melhor tempo da cidade + 50%
     (nunca menos que 40 min) ou perto de uma linha que você escolheu;
   - ranqueia os bairros pelo nível e pela soma dos pesos atingidos. Imóveis só aparecem nessas regiões, e o card
     mostra o tempo até o trabalho.
4. **Buscar imóveis** nas regiões marcadas, em vários sites ao mesmo tempo: portais (QuintoAndar, Chaves na Mão,
   ZAP, VivaReal, Lopes, OLX) e as **imobiliárias da cidade**, achadas no OpenStreetMap ao escolher a cidade
   (as que publicam os anúncios em schema.org são lidas pela extensão genérica). Mostra tudo no mapa. Dá para filtrar por tipo, preço
   (total ou só aluguel) e quartos, e ordenar por preço, trajeto ou área.

**🔗 Meus links**

- Cole links de anúncios (um por linha). Cada um vira um **ícone numerado** no mapa.
  A posição sai da coordenada da página (schema.org `geo`, meta tags, mapa embutido) ou, se não houver,
  do endereço geocodificado (marcado como "aprox.").
- Informe uma **linha de ônibus/metrô** (número como `875A-10`, `609F`, `Linha 4`, ou link do itinerário
  da SPTrans `…?cdp=…`, da relação no OpenStreetMap ou do Moovit). O mapa desenha o **trajeto exato rua a rua**
  com as paradas, e cada anúncio mostra a distância até a parada mais próxima.

## Rodando

```bash
npm install
npm run dev        # API em :3333 + mapa em http://localhost:5173
```

Para usar no dia a dia: dois cliques em `HomeMatch.cmd` (Windows) ou `npm run app`. Monta o mapa, sobe o servidor e abre http://localhost:3333 no navegador; feche a janela para encerrar.

Produção local, passo a passo: `npm run build && npm start` (o servidor entrega o mapa em http://localhost:3333).

No ar: a Vercel publica a cada push na `main` (app na CDN, API como função em São Paulo). Detalhes em
[docs/arquitetura.md](docs/arquitetura.md#deploy-na-vercel). Favoritos e preferências ficam no navegador de cada aparelho.

```bash
npm test           # Vitest (parsers com fixtures reais, modelo de trajeto, grade, rotas da API)
npm run typecheck  # cada pacote com o próprio tsconfig
npm run lint       # ESLint, incluindo quem pode importar quem
npm run check      # tudo acima + build (o mesmo que o CI roda)
```

## Como funciona

Monorepo com npm workspaces (arquitetura e próximos passos em [docs/arquitetura.md](docs/arquitetura.md)):

| Pasta | O que é |
|---|---|
| `packages/contracts` | Schemas zod da API e os tipos derivados deles (uma fonte só para servidor e app) |
| `packages/domain` | Regras puras: geo, modelo de trajeto, nota da grade, filtros, "o que não bate", horários |
| `packages/sources` | Tudo que vem de fora: OSM, operador de ônibus, portais e imobiliárias, links colados |
| `apps/api` | Fastify em camadas: `routes/`, `services/`, `plugins/`, `env.ts` |
| `apps/web` | React + Leaflet por funcionalidade (`features/<nome>/` com `components/`, `hooks/`, `model/` e um `index.ts` público), peças comuns em `shared/` |

| Parte | Onde | Fonte |
|---|---|---|
| Cidades, endereços | `packages/sources/src/osm/nominatim.ts` | Nominatim (1 req/s) |
| Linhas e paradas, lugares | `packages/sources/src/osm/overpass.ts`, `transit.ts`, `features.ts` | Overpass API |
| Nota e ranking | `packages/domain/src/analysis/grid.ts` (orquestrado em `apps/api/src/services/analysis.ts`) | — |
| Imóveis | `packages/sources/src/listings/*` (motor em `core/`, sites em `extensions/`) | portais + sites das imobiliárias (robots.txt respeitado) |
| Imobiliárias da cidade | `packages/sources/src/listings/discovery.ts` | OSM `office=estate_agent` + site de cada uma |
| Meus links | `packages/sources/src/links.ts` | página do anúncio |
| Linha pelo número/link | `packages/sources/src/busline.ts` | Overpass (`out geom`) |
| Mapa | `apps/web/src/features/map` (uma camada por arquivo em `layers/`) | React + Leaflet, tiles OSM |

Tudo que vem de fora fica em cache em `data/cache/` (Overpass 7 dias, anúncios 6 h, geocodificação 30 dias).
A primeira análise de uma cidade grande pode levar alguns minutos; as seguintes saem do cache.

## Limitações conhecidas

- **Trajeto é estimativa**: considera só linhas **diretas** (sem baldeação), com velocidade média por modo
  (ônibus 15 km/h, metrô 32 km/h…) e espera média. Serve para comparar regiões, não substitui o app de rotas.
- Depende do que está mapeado no OpenStreetMap (em SP e capitais as linhas estão bem mapeadas; em cidades menores, nem sempre).
- "Mercado grande / atacarejo" é reconhecido pelo nome/marca (`BULK_MARKET_REGEX` em `features.ts`): ajuste para as redes da sua cidade.
- Os sites de imóveis mudam o HTML/API sem aviso. Quando um raspador quebrar, atualize a fixture em `packages/sources/test/fixtures/`
  e o parse correspondente. QuintoAndar só tem anúncios nas cidades onde opera.
- Uso pessoal: o servidor respeita intervalos entre requisições e usa cache; não rode buscas em massa.

## Adicionando um site (extensão)

O motor comum (`packages/sources/src/listings/core/engine.ts`) já cuida de robots.txt, ritmo, cache, bloqueio, paginação,
total do mês, tipo, comodidades e posição no mapa. Uma extensão só diz o que é particular do site:

1. Crie `packages/sources/src/listings/extensions/<site>.ts` exportando um `SiteExtension` (`core/types.ts`):
   `url(ctx)` da página de busca (por bairro, ou da cidade inteira com `scope: "city"`) e um `parse(html)` **puro**
   que devolve `RawListing[]`. Se o site publica schema.org, use `parseSchemaOrgListings` e pronto.
2. Salve um recorte de uma página real em `packages/sources/test/fixtures/` e teste o parse em `packages/sources/test/listings/extensions.test.ts`.
3. Registre em `packages/sources/src/listings/index.ts` (`extensionSource(...)`) e descreva em `portals.ts`.

Imobiliárias pequenas não precisam de código: se o site delas publica schema.org, a descoberta já as lê. Para uma
**plataforma** de sites de imobiliária (Kenlo, Imoview…), uma extensão serve para todas as imobiliárias que a usam.

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md) (como rodar, regras e checklist do pull request) e o
[código de conduta](CODE_OF_CONDUCT.md). Falhas de segurança: [SECURITY.md](SECURITY.md), nunca em issue pública.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE). Em resumo (o texto da licença é o que vale):

- **Pode:** usar, estudar, modificar e redistribuir, com ou sem mudanças, para fins pessoais, de estudo, pesquisa,
  hobby e por organizações sem fins lucrativos, escolas e órgãos públicos.
- **Não pode:** vender, cobrar pelo uso, oferecer como serviço pago ou usar para gerar renda de qualquer forma.
- **Tem que:** repassar a licença (ou o link dela) e a linha `Required Notice` junto com qualquer cópia.

Por proibir uso comercial, ela não é uma licença "open source" no sentido da OSI: é código aberto não comercial.
