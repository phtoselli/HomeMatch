# HomeMatch

Aplicação local (mapa + servidor) para achar aluguel com base no **trabalho**, no **transporte
público** e no que você quer ter **perto de casa**.

Dois modos:

**🔎 Explorar regiões**

1. Escolha a **cidade** e marque o **trabalho** (endereço ou clique no mapa).
2. Escolha o que precisa por perto (mercado grande/atacarejo, parque, academia, farmácia…) e o raio de cada um.
3. **Analisar a cidade**:
   - busca no OpenStreetMap as linhas de ônibus, metrô e trem com parada perto do trabalho;
   - divide a cidade numa grade (500 m) e estima o tempo de cada pedaço até o trabalho
     (caminhada até a parada + espera + viagem + caminhada final);
   - mantém só as áreas que têm **tudo** o que você pediu dentro do raio;
   - dá nota (trajeto × proximidade, peso ajustável) e ranqueia os bairros.
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

```bash
npm test           # Vitest (parsers com fixtures reais, modelo de trajeto, grade)
npm run typecheck
```

## Como funciona

| Parte | Onde | Fonte |
|---|---|---|
| Cidades, endereços | `src/server/osm/nominatim.ts` | Nominatim (1 req/s) |
| Linhas e paradas, lugares | `src/server/osm/overpass.ts`, `transit.ts`, `features.ts` | Overpass API |
| Nota e ranking | `src/server/analysis.ts` | — |
| Imóveis | `src/server/listings/*` (motor em `core/`, sites em `extensions/`) | portais + sites das imobiliárias (robots.txt respeitado) |
| Imobiliárias da cidade | `src/server/listings/discovery.ts` | OSM `office=estate_agent` + site de cada uma |
| Meus links | `src/server/links.ts` | página do anúncio |
| Linha pelo número/link | `src/server/busline.ts` | Overpass (`out geom`) |
| Mapa | `src/web/*` | React + Leaflet, tiles OSM |

Tudo que vem de fora fica em cache em `data/cache/` (Overpass 7 dias, anúncios 6 h, geocodificação 30 dias).
A primeira análise de uma cidade grande pode levar alguns minutos; as seguintes saem do cache.

## Limitações conhecidas

- **Trajeto é estimativa**: considera só linhas **diretas** (sem baldeação), com velocidade média por modo
  (ônibus 15 km/h, metrô 32 km/h…) e espera média. Serve para comparar regiões, não substitui o app de rotas.
- Depende do que está mapeado no OpenStreetMap (em SP e capitais as linhas estão bem mapeadas; em cidades menores, nem sempre).
- "Mercado grande / atacarejo" é reconhecido pelo nome/marca (`BULK_MARKET_REGEX` em `features.ts`): ajuste para as redes da sua cidade.
- Os sites de imóveis mudam o HTML/API sem aviso. Quando um raspador quebrar, atualize a fixture em `tests/fixtures/`
  e o parse correspondente. QuintoAndar só tem anúncios nas cidades onde opera.
- Uso pessoal: o servidor respeita intervalos entre requisições e usa cache; não rode buscas em massa.

## Adicionando um site (extensão)

O motor comum (`src/server/listings/core/engine.ts`) já cuida de robots.txt, ritmo, cache, bloqueio, paginação,
total do mês, tipo, comodidades e posição no mapa. Uma extensão só diz o que é particular do site:

1. Crie `src/server/listings/extensions/<site>.ts` exportando um `SiteExtension` (`core/types.ts`):
   `url(ctx)` da página de busca (por bairro, ou da cidade inteira com `scope: "city"`) e um `parse(html)` **puro**
   que devolve `RawListing[]`. Se o site publica schema.org, use `parseSchemaOrgListings` e pronto.
2. Salve um recorte de uma página real em `tests/fixtures/` e teste o parse em `tests/listings/extensions.test.ts`.
3. Registre em `src/server/listings/index.ts` (`extensionSource(...)`) e descreva em `portals.ts`.

Imobiliárias pequenas não precisam de código: se o site delas publica schema.org, a descoberta já as lê. Para uma
**plataforma** de sites de imobiliária (Kenlo, Imoview…), uma extensão serve para todas as imobiliárias que a usam.
