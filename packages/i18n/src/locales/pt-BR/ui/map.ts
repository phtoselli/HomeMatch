/** Region level picker (map settings and region list). */
export const levels = {
  all: "Todas",
  goodOrBetter: "Boa ou melhor",
  excellentOnly: "Só excelentes",
  whichRegions: "Quais regiões mostrar",
};

/** Map legend. */
export const legend = {
  legend: "Legenda",
  work: "Trabalho",
  regionLevel: "Nível da região",
  estimatedIntercity: "Intermunicipal (estimado)",
  upTo: (distance: string) => `até ${distance}`,
};

/** "What to show on the map" panel. */
export const mapSettings = {
  afterSearch: "aparece depois da busca",
  title: "Configurações do mapa",
  heading: "O que mostrar no mapa",
  regions: "Regiões",
  regionLevels: "Nível das regiões",
  levelsHint:
    "Excelente: a sua prioridade principal e quase todo o resto. Boa: a principal. Ok: alguma coisa, mas não a " +
    "principal. Vale também para os imóveis da lista.",
  regionNames: "Nomes das melhores regiões",
  buses: "Ônibus",
  workLines: "Linhas que levam ao trabalho",
  workLinesHint: "as que a análise usou",
  myLines: "Linhas que você adicionou",
  onMap: (n: number) => `${n} no mapa`,
  noLinesYet: "nenhuma ainda (Mais opções → linha de ônibus)",
  lineStops: "Pontos dessas linhas",
  linesShown: (shown: number, total: number) => `${shown} de ${total} linhas no mapa`,
  all: "Todas",
  none: "Nenhuma",
  filterLines: "Filtrar: número, bairro…",
  towards: (destination: string) => `Sentido ${destination}`,
  noLineMatch: (q: string) => `Nenhuma linha com "${q}".`,
  places: "Lugares perto de casa",
  showPlaces: "Mostrar lugares",
  noPlacesChosen: "nenhum escolhido na busca",
  listings: "Imóveis",
  searchListings: "Imóveis da busca",
  myLinks: "Meus links",
  map: "Mapa",
  cityBoundary: "Limite da cidade",
  restoreDefaults: "Voltar ao padrão",
};

/** Map tooltips (Leaflet HTML: callers escape outside text). */
export const map = {
  cellCommute: (minutes: number, via: string) => `~${minutes} min até o trabalho (${via})`,
  regionBadge: (minutes: number, score: string, selected: boolean) =>
    `~${minutes} min até o trabalho · nota ${score}<br><small>clique para ${selected ? "tirar da" : "incluir na"} ` +
    `busca de imóveis</small>`,
};
