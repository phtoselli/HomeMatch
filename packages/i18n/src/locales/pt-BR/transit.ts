const modes = {
  bus: "Ônibus",
  trolleybus: "Trólebus",
  tram: "Bonde/VLT",
  light_rail: "VLT",
  monorail: "Monotrilho",
  subway: "Metrô",
  train: "Trem",
};

/** Lines, routes and how a commute is described. */
export const transit = {
  modes,
  /** "Ônibus 353", or "Ônibus: <name>" when the line has no number. */
  routeLabel: (mode: string, ref: string | undefined, name: string) => (ref ? `${mode} ${ref}` : `${mode}: ${name}`),
  /** Default name of a line known only by its number. */
  lineName: (ref: string) => `Linha ${ref}`,
  withTransfer: (first: string, then: string) => `${first} + ${then}`,
  onFoot: "a pé",
  estimatedBus: "ônibus (estimado)",
  estimatedIntercityBus: "ônibus intermunicipal (estimado)",
  estimatedIntercity: "intermunicipal (estimado)",
  viaTerminal: (terminal: string, then?: string) =>
    `intermunicipal (estimado) até ${terminal}${then ? ` + ${then}` : ""}`,
  alightOnlyStop: "(só desembarque)",
  busTerminal: "Terminal de ônibus",
  busStation: "Estação de ônibus",
  chooseCityFirst: "Escolha a cidade antes (a busca pelo número da linha é feita dentro dela).",
  emdecProvides: "trajetos oficiais, pontos de parada em ordem, nomes e destinos das linhas municipais",
  lineRoles: {
    nearWork: "passa perto do trabalho",
    intercity: "intermunicipal",
    estimated: "trecho estimado",
    toWork: "leva ao trabalho",
    mine: "você adicionou",
  },
};
