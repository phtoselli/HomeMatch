# HomeMatch

**Encontre um lugar para alugar pensando no trabalho, no caminho até lá e no que você quer ter por perto.**

O HomeMatch é um app web com mapa para quem procura aluguel em cidades brasileiras. Você informa a cidade, o
trabalho, quanto quer pagar e o que é importante (ônibus rápido até o trabalho, parque, mercado grande…). Ele
analisa a cidade inteira, destaca os bairros que combinam com você e busca anúncios em vários portais e
imobiliárias da cidade ao mesmo tempo.

Sem cadastro e sem banco de dados: favoritos e preferências ficam no seu navegador.

> 🇺🇸 Read in English: [README.md](README.md)

No ar: <https://home-match-delta.vercel.app>

---

## Rodando no seu computador (5 minutos)

### 1. Instale o necessário

- **Node.js 22 ou mais novo**: baixe a versão LTS em <https://nodejs.org> e instale com as opções padrão.
- **Git** (opcional, só para clonar): <https://git-scm.com>. Também dá para baixar o projeto em ZIP no GitHub
  (botão verde **Code** → **Download ZIP**).

Confira se o Node está instalado abrindo um terminal (no Windows: *PowerShell*) e rodando:

```bash
node --version
```

Deve aparecer `v22` ou maior.

### 2. Baixe o código

```bash
git clone https://github.com/phtoselli/HomeMatch.git
cd HomeMatch
```

(Se baixou o ZIP, descompacte e abra o terminal dentro da pasta.)

### 3. Instale as dependências

```bash
npm install
```

> **Dica para Windows:** se o PowerShell disser que a execução de scripts está desabilitada, use
> `npm.cmd install` (e `npm.cmd` nos comandos abaixo).

### 4. Abra o app

```bash
npm run app
```

Isso monta o app, sobe o servidor local e abre <http://localhost:3333> no navegador. Para fechar, feche a janela do
terminal (ou aperte `Ctrl+C`). No Windows, também dá para dar dois cliques em **`HomeMatch.cmd`**.

Pronto. 🎉

### Como usar

1. **Escolha a cidade** e **marque o trabalho** (digite o endereço ou clique no mapa).
2. Diga **quanto quer pagar**, quantos quartos precisa e **o que quer ter por perto** (mercado, parque, academia,
   farmácia…) e escolha o que é mais importante: o transporte até o trabalho ou algum desses lugares.
3. Clique em **Mostrar imóveis**. A primeira análise de uma cidade pode levar alguns minutos; depois fica em cache.
4. O mapa pinta cada área como **excelente**, **boa** ou **ok**, e a lista mostra os imóveis das melhores regiões
   com o tempo até o trabalho e o que bate (ou não) com o seu pedido.
5. Clique em **Exportar PDF** para baixar um **perfil de busca** para enviar a uma imobiliária: mapa com as regiões
   recomendadas e as linhas de ônibus, suas necessidades e prioridades e dicas de busca. O PDF nunca leva anúncios
   nem links, só o que a imobiliária precisa para procurar no próprio acervo.

---

## Para quem desenvolve

```bash
npm run dev        # API em :3333 + app com recarga automática em http://localhost:5173
npm test           # Vitest (parsers com fixtures reais, modelo de trajeto, grade, rotas da API, dados do PDF)
npm run typecheck  # cada pacote com o próprio tsconfig
npm run lint       # ESLint, incluindo as regras de import da arquitetura
npm run check      # tudo acima + build (o mesmo que o CI roda)
```

O código, os comentários e a documentação técnica estão em inglês; os textos da interface ficam no catálogo
`packages/i18n/src/locales/pt-BR`. Estrutura, padrões (feature-based + Atomic Design) e fontes de dados estão no
[README em inglês](README.md#for-developers) e em [docs/architecture.md](docs/architecture.md).

## Contribuindo

Veja o [CONTRIBUTING.md](CONTRIBUTING.md) e o [código de conduta](CODE_OF_CONDUCT.md). Falhas de segurança:
[SECURITY.md](SECURITY.md), nunca em issue pública.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE). Em resumo (o texto da licença é o que vale):

- **Pode:** usar, estudar, modificar e redistribuir, com ou sem mudanças, para fins pessoais, de estudo, pesquisa e
  hobby, e em organizações sem fins lucrativos, escolas e órgãos públicos.
- **Não pode:** vender, cobrar pelo uso, oferecer como serviço pago ou usar para gerar renda de qualquer forma.
- **Tem que:** repassar a licença (ou o link dela) e a linha `Required Notice` junto com qualquer cópia.

Por proibir uso comercial, ela não é uma licença "open source" no sentido da OSI: é código aberto não comercial.
