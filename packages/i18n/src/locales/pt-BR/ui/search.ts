/** Search progress (store) and place search. */
export const search = {
  warningLine: (message: string) => `Aviso: ${message}`,
  widening: (found: number, regions: number) =>
    `Só ${found} ${found === 1 ? "anúncio" : "anúncios"} até agora. ` +
    `Ampliando a busca para mais ${regions} ${regions === 1 ? "região" : "regiões"}…`,
  diagnosing: "Nenhum anúncio com esses filtros. Vendo o que existe por perto do seu orçamento…",
  listingsDone: "Busca de imóveis concluída.",
  regionsFound: (excellent: number, good: number, ok: number, top: number) =>
    `Regiões: ${excellent} excelentes, ${good} boas e ${ok} ok.` +
    (top ? ` Buscando imóveis nas ${top} melhores…` : ""),
  pointOnMap: "Ponto marcado no mapa",
  nothingFound: "Nada encontrado. Tente só rua e número, ou marque no mapa.",
};

/** Priority picker. */
export const priorities = {
  main: "Principal",
  important: "Importante",
  nice: "Bom ter",
  notUsed: "Não uso",
  transit: "Transporte até o trabalho",
  transitDetail: "ônibus, trem ou a pé",
  within: (distance: string) => `a até ${distance}`,
  importanceOf: (what: string) => `Importância: ${what}`,
};

/** Listing sources picker. */
export const sources = {
  status: {
    ok: "",
    robots: "não permite robôs",
    blocked: "bloqueia leitura automática",
    "no-data": "falta extensão",
    error: "fora do ar",
  },
  lookingForAgencies: (city?: string) => `Procurando imobiliárias${city ? ` em ${city}` : ""}…`,
  searchingPortals: (n: number) => `Buscando em ${n} portais.`,
  searchingIn: (portals: number, agencies: number, city?: string) =>
    `Buscando em ${portals} ${portals === 1 ? "portal" : "portais"}` +
    (agencies ? ` e ${agencies} ${agencies === 1 ? "imobiliária" : "imobiliárias"}${city ? ` de ${city}` : ""}` : "") +
    ".",
  portals: "Portais",
  agenciesOf: (city?: string) => `Imobiliárias ${city ? `de ${city}` : "da cidade"}`,
  readableOf: (readable: number, total: number) => `${readable} de ${total} dá para ler`,
  noAgencies: "nenhuma encontrada ainda",
  addAgency: "Achou uma imobiliária que não está aqui? Cole o site dela:",
  addAgencyPlaceholder: "ex.: www.imobiliaria.com.br",
  addAgencyButton: "Adicionar",
  invalidSite: "Esse endereço não parece um site.",
  addedByYou: "adicionada por você",
  removeAgency: (name: string) => `Tirar ${name} da lista`,
  checkingSite: "Verificando o site…",
  chooseCity: "Escolha a cidade para procurar as imobiliárias dela.",
  disclaimer:
    "As imobiliárias vêm das que você adicionou, de uma lista por cidade e do OpenStreetMap. Respeitamos o " +
    "robots.txt de cada site e não contornamos bloqueios.",
};
