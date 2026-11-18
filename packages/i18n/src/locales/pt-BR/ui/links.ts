/** "Links and lines" panel: pasted listings and bus lines. */
export const links = {
  alreadyOnMap: "Esses links já estão no mapa.",
  pasteAtLeastOne: "Cole pelo menos um link começando com http.",
  marked: (ok: number, total: number) => `${ok} de ${total} link(s) marcados no mapa.`,
  lookingOnOperator: (operator: string) => `Procurando a linha no site da ${operator}…`,
  lookingOnOsm: "Procurando a linha no OpenStreetMap… (a primeira busca pode levar ~1 min)",
  lineNotFound: (q: string, city?: string) =>
    `Não achei a linha "${q}" ${city ? `em ${city}` : "nesta área do mapa"}. Tente o número com a variante ` +
    `(ex.: 875A-10) ou o link da linha no OpenStreetMap.`,
  variantsFound: (n: number, q: string) => `${n} sentido(s)/variante(s) encontrados para "${q}".`,
  nearWorkOnOperator: (operator: string) =>
    `Procurando no site da ${operator} as linhas com parada perto do trabalho… (a 1ª vez baixa a rede toda, ~15 MB)`,
  nearWorkOnOsm: "Procurando no OpenStreetMap as linhas com parada perto do trabalho… (pode levar ~1 min)",
  noLineNearWork: "Nenhuma linha com parada a até 700 m do trabalho.",
  linesNearWork: (refs: string[]) =>
    `${refs.length} linha(s) passam perto do trabalho: ${refs.join(", ")}. Clique numa linha para ver só o trajeto dela.`,
  yourListings: "Seus anúncios",
  pasteHint:
    "Cole links de anúncios (QuintoAndar, VivaReal ou site de imobiliária), um por linha. Cada um vira um ícone " +
    "numerado no mapa.",
  reading: "Lendo links…",
  markOnMap: "Marcar no mapa",
  clear: "Limpar",
  noPrice: "sem preço",
  bedroomsShort: (n: number) => `${n} qto`,
  approx: "aprox.",
  stopAt: (distance: string, minutes: number) => `parada a ${distance} (~${minutes} min a pé)`,
  farFromLine: "longe (> 3 km)",
  couldNotMark: "Não consegui marcar",
  remove: "Remover",
  removeLine: "Remover linha",
  onMapSummary: (n: number) => `${n} no mapa. Os marcados como "aprox." foram posicionados pelo endereço do anúncio.`,
  busLine: "Linha de ônibus / metrô",
  lineHintBefore: "Número da linha (ex.:",
  lineHintMiddle: "ou um link: itinerário da SPTrans",
  lineHintAfter: ", relação do OpenStreetMap ou Moovit. O trajeto é desenhado rua por rua com as paradas.",
  linePlaceholder: "Número ou link da linha",
  show: "Mostrar",
  noCity: "Sem cidade escolhida, a busca usa a área visível do mapa.",
  officialSourceBefore: (city: string) => `Em ${city}, as linhas vêm do site oficial da`,
  officialSourceAfter: ": trajeto e todos os pontos de parada.",
  osmSource: (city: string) => `Em ${city}, as linhas vêm do OpenStreetMap (pode faltar alguma linha).`,
  linesNearWorkButton: (needsWork: boolean) =>
    `Linhas que passam perto do trabalho${needsWork ? " (marque o trabalho)" : ""}`,
  direction: (n: number) => `sentido ${n}`,
  stops: (n: number) => `${n} paradas`,
  officialMap: "mapa oficial",
  stopFromWork: (distance: string) => `ponto a ${distance} do trabalho`,
  notNearWork: "não passa perto do trabalho",
};

/** Transit components: line popover and timetable. */
export const linePopover = {
  next: (time: string) => `próxima ${time}`,
  loading: "Buscando sentidos e horários…",
  stopsPerDirection: (n: number) => `${n} pontos por sentido`,
  seeTimetable: "Ver horários",
  noTimetable: "Sem grade de horários publicada para esta linha.",
  hide: "Esconder",
  openOperatorSite: "Abrir no site do operador",
  pinTip: "Clique na linha para fixar este quadro",
};

export const timetable = {
  title: (line: string) => `Horários da linha ${line}`,
  loadFailed: "Não deu para buscar a grade agora no site do operador.",
  direction: "Sentido",
  day: "Dia",
  today: "hoje",
  nextDeparture: "Próxima saída",
  inMinutes: (n: number) => `(daqui a ${n} min)`,
  thenAt: (times: string[]) => `, depois ${times.join(" e ")}`,
  noMoreToday: "Sem mais saídas hoje nesse sentido.",
  noneThatDay: "Sem saídas nesse dia.",
  summary: (n: number, updated?: string) =>
    `${n} saídas · horários de partida do ponto inicial${updated ? ` · atualizado pelo operador em ${updated}` : ""}.`,
};

export const transit = {
  lineNotFound: (q: string, city?: string) => `Não achei a linha "${q}"${city ? ` em ${city}` : ""}.`,
};
