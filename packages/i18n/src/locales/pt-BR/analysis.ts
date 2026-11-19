const listRefs = (refs: string[]) =>
  refs.length ? `: ${refs.slice(0, 8).join(", ")}${refs.length > 8 ? "…" : ""}` : "";

/** Progress and warnings of the region analysis. */
export const analysis = {
  mappingPlaces: (labels: string[]) => `Mapeando ${labels.join(", ").toLowerCase()} e os bairros da cidade…`,
  placesUnavailable: (place: string) =>
    `O OpenStreetMap está lotado e não deu para mapear ${place.toLowerCase()} agora; ele ficou fora do nível das ` +
    `regiões nesta busca. Tente de novo em alguns minutos.`,
  noPlaces: (place: string) => `Nenhum(a) ${place} encontrado(a) no OpenStreetMap nessa área.`,
  neighborhoodsUnavailable: "O OpenStreetMap está lotado e não deu para buscar os nomes dos bairros agora.",
  scoring: "Cruzando trajeto e características em cada pedaço da cidade…",
  noRegions: "Nenhuma região atinge o que você pediu. Aumente as distâncias dos lugares ou mude as prioridades.",
  mainNotMet: "Nenhuma região atinge a sua prioridade principal; mostrando as que atingem as outras (ok).",
  levelsSummary: (excellent: number, good: number, ok: number, bestMin: number, refMin: number, directMin: number) =>
    `Áreas por nível: ${excellent} excelentes, ${good} boas e ${ok} ok. ` +
    `Tempo até o trabalho: o melhor é ${bestMin} min; até ${refMin} min conta como bem servido ` +
    `(até ${directMin} min num ônibus direto, sem baldeação).`,
};

/** How work is reached: lines near work, intercity lines and estimates. */
export const commute = {
  loadingOperator: (operator: string) => `Baixando as linhas oficiais de ${operator} (trajetos e pontos)…`,
  operatorFailed: (operator: string, reason: string) =>
    `Não deu para ler as linhas de ${operator}: ${reason}. Usando o OpenStreetMap.`,
  searchingNearWork: "Buscando linhas de ônibus, metrô e trem que passam perto do trabalho…",
  nearWorkUnavailable: "O OpenStreetMap está lotado e não deu para buscar as linhas perto do trabalho agora.",
  localSummary: (s: { nearCount: number; refs: string[]; source?: string; withTransfer?: number; stops: number }) =>
    `${s.nearCount} linhas passam perto do trabalho${s.source ? ` (fonte: ${s.source})` : ""}${listRefs(s.refs)}` +
    (s.withTransfer != null ? `; com uma baldeação, ${s.withTransfer} linhas levam até lá` : "") +
    ` — ${s.stops} pontos de embarque.`,
  fewLinesSearchingStops: "Poucas linhas mapeadas no OpenStreetMap aqui; buscando os pontos de ônibus da cidade…",
  estimatedBusLocal: (n: number) =>
    `Só ${n} linha(s) com itinerário no OpenStreetMap perto do trabalho. Para o resto, o tempo é "ônibus (estimado)": ` +
    `ponto perto de casa + ponto perto do trabalho, em linha quase reta a 15 km/h. Confira a linha real no modo "Meus links".`,
  estimatedBusIntercity: (n: number) =>
    `Só ${n} linha(s) com itinerário no OpenStreetMap perto do trabalho. Para o resto, o tempo é ` +
    `"ônibus intermunicipal (estimado)": ponto perto de casa + ponto perto do trabalho, uns 6 km no ritmo da cidade ` +
    `(15 km/h) e o resto por rodovia (40 km/h). Confira a linha real no modo "Meus links".`,
  walkOnly: "Nenhuma linha nem ponto de ônibus no OpenStreetMap perto do trabalho; só a caminhada foi considerada.",
  workElsewhere: (city: string) => `O trabalho fica em ${city}: primeiro, as linhas que passam perto dele…`,
  nearWorkThenIntercity: (n: number, city: string, operator: string | undefined, refs: string[], home: string) =>
    `${n} linhas passam perto do trabalho em ${city}${operator ? ` (${operator})` : ""}${listRefs(refs)}. ` +
    `Agora, as linhas intermunicipais de ${home} para lá…`,
  intercityUnavailable: (reason: string) => `Não deu para buscar as linhas intermunicipais no OpenStreetMap: ${reason}`,
  intercitySummary: (s: { lines: number; home: string; work: string; operator?: string; stops: number }) =>
    `${s.lines} linha(s) intermunicipal(is) mapeada(s) entre ${s.home} e ${s.work}` +
    (s.operator ? `; em ${s.work}, baldeação pelas linhas de ${s.operator}` : "") +
    ` — ${s.stops} pontos de embarque em ${s.home}.`,
  estimatedViaTerminal: (used: number, home: string, work: string, operator?: string) =>
    (used
      ? `Só ${used} linha(s) intermunicipal(is) de ${home} para ${work} no OpenStreetMap. Para o resto, `
      : `Nenhuma linha intermunicipal de ${home} para ${work} está no OpenStreetMap. Por isso, `) +
    `o tempo é "intermunicipal (estimado)": ponto perto de casa → terminal de ${work} por rodovia ` +
    `(uns 6 km a 15 km/h e o resto a 40 km/h)` +
    (operator ? ` → linha da ${operator} até o trabalho. ` : ` → ônibus ou a pé até o trabalho. `) +
    `Confira a linha real no modo "Meus links".`,
  estimatedDirectIntercity: (home: string, work: string) =>
    `Nenhuma linha intermunicipal de ${home} para ${work} no OpenStreetMap. O tempo é ` +
    `"ônibus intermunicipal (estimado)": ponto perto de casa + ponto perto do trabalho, uns 6 km no ritmo ` +
    `da cidade e o resto por rodovia (40 km/h). Confira a linha real no modo "Meus links".`,
  noConnection: (home: string, work: string) =>
    `Nenhuma linha nem ponto de ônibus no OpenStreetMap ligando ${home} a ${work}.`,
  estimatedLegName: (home: string, terminal: string) => `Intermunicipal (estimado): ${home} → ${terminal}`,
};
