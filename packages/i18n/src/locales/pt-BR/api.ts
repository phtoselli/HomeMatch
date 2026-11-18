/** Validation and API errors shown to the user. */
export const api = {
  invalidOsmId: "id do OpenStreetMap inválido",
  invalidLineId: "id de linha inválido",
  invalidParams: "Parâmetros inválidos",
  noTimetable: "Essa linha não tem grade de horários publicada pelo operador.",
  lineNotFound: (ref: string) => `Linha ${ref} não encontrada no site do operador.`,
};
