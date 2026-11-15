# Segurança

## Como reportar uma vulnerabilidade

Não abra uma issue pública. Use a aba **Security → Report a vulnerability** do repositório no GitHub (aviso
privado de segurança). Descreva o problema, como reproduzir e o impacto que você enxerga.

A resposta inicial deve sair em até 7 dias. Corrigido o problema, o aviso pode ser publicado com o crédito a quem
reportou, se a pessoa quiser.

## Versões cobertas

Só a versão da branch `main` (a que está publicada) recebe correções.

## O que já é tratado

- **Sem dados pessoais no servidor:** favoritos, filtros e endereço do trabalho ficam no `localStorage` do navegador.
  O endereço só passa pela API durante a análise e não é guardado.
- **SSRF:** "Meus links" baixa só endereços `http(s)` públicos. O texto da URL é conferido, cada redirecionamento
  também, e o IP é conferido na hora da conexão (protege contra DNS rebinding). A página tem limite de tamanho.
- **XSS:** links vindos de anúncios, do OpenStreetMap ou de sites de operadores só viram `href` se forem
  `http(s)`. Textos de fora que vão para o mapa (tooltips do Leaflet) são escapados. A CSP só permite scripts do
  próprio app.
- **Entradas:** toda rota valida o corpo e os parâmetros com zod (`packages/contracts`), com limites de tamanho.
- **Consultas ao Overpass:** texto do usuário entra nas consultas sempre escapado.
- **Dependências:** o CI roda `npm audit` (dependências de produção, nível alto).
