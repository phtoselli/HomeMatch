# Como contribuir

Obrigado pelo interesse no HomeMatch. Este guia explica como rodar o projeto, as regras do código e o que
esperamos de um pull request.

## Licença das contribuições

O HomeMatch é distribuído sob a [PolyForm Noncommercial 1.0.0](LICENSE): qualquer pessoa pode usar, estudar,
modificar e redistribuir, **desde que sem fins comerciais**. Ao enviar uma contribuição, você concorda que ela
seja distribuída nos mesmos termos.

## Preparando o ambiente

Precisa de Node.js 22 ou mais novo (o mesmo da Vercel e do CI).

```bash
npm install
npm run dev     # API em :3333 + app em http://localhost:5173
```

Não há banco de dados nem serviço extra para subir: a API lê as fontes públicas na hora, com cache em `data/`
(fora do git), e o app guarda as preferências da pessoa no `localStorage` do navegador.

## Antes de abrir o pull request

```bash
npm run check   # formatação, lint, tipos, testes e build: o mesmo que o CI roda
```

Checklist:

- [ ] `npm run check` passa.
- [ ] Mudou uma regra de negócio? Ela está em `packages/domain`, com teste.
- [ ] Mudou o contrato da API? Mudou o schema em `packages/contracts` (a validação da rota e os tipos do app saem dele).
- [ ] Mexeu num raspador? O parse é uma função pura com teste e fixture real em `packages/sources/test/fixtures/`.
- [ ] Nada guardado no servidor que precise durar: o que é da pessoa fica no `localStorage`.

## Regras do projeto

- **Arquitetura:** monorepo com `apps/web`, `apps/api` e `packages/{contracts,domain,sources}`. As setas de
  dependência estão em [docs/arquitetura.md](docs/arquitetura.md) e o ESLint barra o resto.
- **App React:** organizado por funcionalidade (`src/features/<nome>/`). Cada funcionalidade só é usada por fora
  pelo seu `index.ts`; peças sem regra de negócio vão para `src/shared/`. Detalhes em
  [docs/arquitetura.md](docs/arquitetura.md#app-react).
- **Respeito às fontes:** toda chamada externa passa por `packages/sources/src/http.ts` (ritmo por host, novas
  tentativas, cache). Nada de contornar bloqueio: se um site pedir captcha, login ou bloquear, o raspador registra
  o aviso e segue com as outras fontes. Sem plugins de "stealth", sem rotação de IP, sem API interna de site com
  cabeçalhos forjados. O motor respeita o `robots.txt`.
- **Nominatim:** no máximo 1 requisição por segundo, com o User-Agent do app.
- **Links colados pelo usuário:** só endereços públicos (`assertPublicUrl` + conferência do DNS na conexão).
- **Links vindos de fora** (anúncios, OpenStreetMap, sites de operadores) só viram `href` depois de passar por
  `safeExternalUrl` (só `http`/`https`).

## Reportando problemas

- Bugs e ideias: abra uma issue com os modelos em `.github/ISSUE_TEMPLATE/`.
- Falhas de segurança: **não** abra issue pública; veja [SECURITY.md](SECURITY.md).

Siga o [código de conduta](CODE_OF_CONDUCT.md) em issues, pull requests e discussões.
