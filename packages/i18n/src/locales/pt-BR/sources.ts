/** Messages from external sources: network guard, OpenStreetMap, portals and agencies. */
export const sources = {
  pageTooLarge: (mb: number) => `página grande demais (${mb} MB)`,
  pageOverLimit: (mb: number) => `página grande demais (mais de ${mb} MB)`,
  privateNetwork: "Link de rede local não é permitido",
  httpOnly: "Use um link http(s)",
  overpassUnavailable: (details: string) => `Overpass indisponível. ${details}`,
  cityNotFound: (osmId: string) => `Cidade ${osmId} não encontrada`,
  agenciesFound: (n: number, city: string) =>
    `${n} imobiliárias com site em ${city} no OpenStreetMap. Vendo quais dá para ler…`,
  agenciesFailed: (reason: string) => `Não deu para buscar as imobiliárias da cidade: ${reason}`,
  agencyNotes: {
    robots: "O site pede para robôs não lerem (robots.txt). Respeitamos.",
    blocked: "O site barra leitura automática.",
    down: "O site não respondeu agora.",
    readable: (n: number) => `${n} anúncios de aluguel na primeira página.`,
    robotsRentals: "O site pede para robôs não lerem a página de aluguel (robots.txt).",
    noStandardFormat: (platform?: string) =>
      `A página de aluguel não traz os anúncios num formato padrão: falta uma extensão${platform ? ` para ${platform}` : " para este site"}.`,
    noRentalsPage: "Não achamos a página de aluguel no site.",
  },
  portalNotes: {
    chavesnamao: "Junta anúncios de várias imobiliárias. 30 por bairro (o site só permite a 1ª página a robôs).",
    zapimoveis: "Endereço aproximado quando o anúncio não traz o número.",
    vivareal: "Às vezes bloqueia a leitura automática.",
    lopes: "Os 23 primeiros de cada bairro.",
    olx: "Busca pela cidade; posição aproximada (centro do bairro).",
  },
  robotsPage: "o site pede para robôs não lerem essa página (robots.txt); respeitando",
  siteDown: "o site não respondeu",
  blockedRecently: "o site bloqueou a leitura automática há pouco; tente de novo em alguns minutos",
  blocked: (status: number) => `o site bloqueou a leitura automática (HTTP ${status}); tente mais tarde`,
  listingsFound: (source: string, region: string, n: number) => `${source} · ${region}: ${n} anúncios`,
  quintoandarFound: (region: string, n: number, total?: number) =>
    `QuintoAndar · ${region}: ${n} de ${total ?? "?"} anúncios`,
  vivarealNoNeighborhood: (region: string) => `VivaReal · ${region}: bairro não encontrado no site`,
  unknownSource: (id: string) => `${id}: fonte desconhecida ou que não dá para ler agora; pulando.`,
  sourceBlockedSkip: (source: string, reason: string) => `${source}: ${reason}. Pulando as outras regiões nessa fonte.`,
};
