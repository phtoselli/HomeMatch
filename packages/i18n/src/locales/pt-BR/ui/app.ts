/** App shell: credits, map tools, top bar and filter bar. */
export const app = {
  transit: "Transporte",
  resetConfirm:
    "Resetar tudo? Isso apaga a busca, as prioridades, os favoritos, os links colados e as linhas que você " +
    "adicionou neste navegador, e volta ao padrão inicial. Não dá para desfazer.",
  credits: (operator?: string) =>
    `Dados: © OpenStreetMap${operator ? `, ${operator}` : ""} e os sites dos anúncios. Tempos de trajeto são ` +
    `estimativas (até uma baldeação).`,
  mapSettings: "Configurar o mapa",
  pickWork: "Clique no mapa onde fica o seu trabalho",
};

export const topBar = {
  yourSearch: "Sua busca",
  city: "Cidade",
  work: "Trabalho",
  priority: "Prioridade",
  rent: "Aluguel",
  total: "Total",
  choose: "escolher",
  mark: "marcar",
  noLimit: "sem limite",
  budgetPerMonth: (amount: string) => `~${amount}/mês`,
  edit: (what: string) => `Editar ${what.toLowerCase()}`,
  whatToSee: "O que ver",
  listings: "Imóveis",
  linksAndLines: (n: number) => `Links e linhas${n ? ` (${n})` : ""}`,
  reset: "Resetar tudo",
  resetHint: "Apagar tudo e voltar ao padrão",
  editSearch: "Editar busca",
};

export const filterBar = {
  upTo: (amount: string) => `Até ${amount}`,
  anyPrice: "Qualquer preço",
  bedroomsPlus: (n: number) => `${n}+ quartos`,
  anyBedrooms: "Quartos: tanto faz",
  priority: (what: string) => `Prioridade: ${what}`,
  placeWithin: (place: string, distance: string) => `${place} a até ${distance}`,
  placeAt: (place: string, distance: string) => `${place} a ${distance}`,
  moreOptions: "Mais opções",
};
