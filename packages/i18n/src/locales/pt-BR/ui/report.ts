/** "Export PDF": a search profile to send to a real estate agency (no listings, no links). */
export const report = {
  button: "Exportar PDF",
  buttonHint:
    "Gera um PDF com o mapa, as regiões, as linhas de ônibus e as suas prioridades para enviar a uma imobiliária",
  needsAnalysis: "Faça a busca primeiro: o PDF usa as regiões encontradas",
  generating: "Gerando PDF…",
  failed: "Não deu para gerar o PDF agora. Tente de novo.",
  fileName: (city: string, date: string) => `perfil-de-busca-${city}-${date}.pdf`,

  // ---- Document
  brand: "HomeMatch",
  title: "Perfil de busca de imóvel para locação",
  subtitle: (city: string) => `Regiões, transporte e necessidades do cliente em ${city}`,
  generatedOn: (date: string) => `Gerado em ${date}`,
  intro:
    "Este documento resume o que o cliente procura e onde: as regiões recomendadas pela análise de trajeto até o " +
    "trabalho e do que ele quer ter por perto, as linhas de ônibus que atendem essas regiões e os requisitos do " +
    "imóvel. Ele não traz anúncios: serve para a imobiliária buscar no próprio acervo.",
  page: (n: number, total: number) => `Página ${n} de ${total}`,
  footer: "Perfil gerado pelo HomeMatch a partir de dados abertos. Não contém anúncios nem links de imóveis.",

  // ---- Sections
  profileTitle: "1. O que o cliente procura",
  prioritiesTitle: "2. Prioridades do cliente",
  mapTitle: "3. Mapa das regiões recomendadas",
  regionsTitle: "4. Regiões recomendadas",
  linesTitle: "5. Linhas de ônibus que atendem as regiões",
  hintsTitle: "6. Como buscar imóveis para este cliente",
  methodTitle: "Como as regiões foram escolhidas",

  // ---- Profile rows
  city: "Cidade onde quer morar",
  work: "Local de trabalho (referência)",
  budget: "Valor mensal",
  budgetValue: (target: string, basis: string) => `até ${target} (${basis})`,
  budgetNone: "sem limite definido",
  budgetCeiling: (ceiling: string, slack: number) => `aceita até ${ceiling} se o imóvel compensar (+${slack}%)`,
  basisTotal: "total: aluguel + condomínio + IPTU",
  basisRent: "só o aluguel",
  types: "Tipo de imóvel",
  anyType: "qualquer tipo",
  bedrooms: "Quartos",
  bathrooms: "Banheiros",
  parking: "Vagas de garagem",
  area: "Área útil",
  atLeast: (n: number) => `no mínimo ${n}`,
  atLeastArea: (n: number) => `no mínimo ${n} m²`,
  noMinimum: "sem mínimo",
  mustHave: "Itens indispensáveis",
  noMustHave: "nenhum item obrigatório",
  commute: "Tempo até o trabalho",
  commuteValue: (best: number, ref: number, direct?: number) =>
    `o ideal é até ~${ref} min de porta a porta${direct ? `, ou ~${direct} min num ônibus direto` : ""} ` +
    `(o melhor trajeto da cidade leva ~${best} min)`,

  // ---- Priorities table
  priority: "Prioridade",
  importance: "Importância",
  detail: "Detalhe",
  transit: "Transporte público até o trabalho",
  transitDetail: "ônibus, trem ou a pé",
  placeDetail: (distance: string) => `a até ${distance} a pé`,
  importanceLabels: { 3: "Principal", 2: "Importante", 1: "Bom ter" } as Record<number, string>,

  // ---- Map legend
  legendWork: "Trabalho",
  legendRegion: "Região recomendada (número da tabela)",
  legendLine: "Linha de ônibus",
  legendEstimated: "Trecho intermunicipal estimado",
  legendBoundary: "Limite da cidade",
  mapAttribution: "Mapa © colaboradores do OpenStreetMap",
  mapUnavailable: "O mapa de fundo não carregou; as regiões e linhas aparecem sem as ruas.",

  // ---- Regions table
  rank: "#",
  region: "Região / bairro",
  level: "Nível",
  commuteCol: "Até o trabalho",
  linesCol: "Linhas",
  nearbyCol: "Perto (a pé)",
  minutesRange: (min: number, avg: number) => (avg > min ? `${min}-${avg} min` : `${min} min`),
  onFoot: "a pé",
  noBus: "sem ônibus perto",
  regionsNote: (shown: number, total: number) =>
    shown < total ? `As ${shown} melhores de ${total} regiões encontradas.` : `${total} regiões encontradas.`,

  // ---- Lines table
  line: "Linha",
  route: "Itinerário",
  operator: "Operador",
  role: "Papel",
  regionsServed: "Regiões atendidas",
  addedByClient: "indicada pelo cliente",
  noLines: "Nenhuma linha mapeada nessas regiões: a análise estimou o trajeto pelos pontos de ônibus.",

  // ---- Search hints
  hintNeighbourhoods: (names: string[]) => `Bairros para buscar, em ordem de preferência: ${names.join(", ")}.`,
  hintPrice: (target: string, ceiling: string | null, basis: string) =>
    `Valor: até ${target} por mês (${basis})${ceiling ? `; vale mostrar opções até ${ceiling}` : ""}.`,
  hintProperty: (parts: string[]) => `Imóvel: ${parts.join(", ")}.`,
  hintMustHave: (items: string[]) => `Indispensável: ${items.join(", ")}.`,
  hintTransit: (lines: string[]) =>
    `Transporte: priorize imóveis a poucos minutos a pé de um ponto ${lines.length ? `das linhas ${lines.join(", ")}` : "de ônibus"}.`,
  hintPlaces: (places: string[]) => `Por perto, a pé: ${places.join("; ")}.`,
  hintFlexible: "Se faltar opção nos bairros principais, as regiões seguintes da tabela também atendem.",

  method: [
    "A cidade foi dividida em quadras e cada uma recebeu um nível (excelente, boa ou ok) conforme as prioridades do cliente: tempo de transporte até o trabalho e distância a pé até os lugares que ele quer ter por perto.",
    "O tempo até o trabalho soma caminhada até o ponto, espera e viagem, pelas linhas do operador ou do OpenStreetMap. Quando não há linha mapeada entre cidades, o trecho é estimado.",
    "Os valores são estimativas para orientar a busca, não garantias de trajeto.",
  ],
};
