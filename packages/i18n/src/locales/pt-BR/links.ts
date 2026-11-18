/** Pasted listing links. */
export const links = {
  property: "Imóvel",
  reading: (n: number, total: number) => `Lendo link ${n} de ${total}…`,
  tooManyRedirects: "redirecionamentos demais",
  siteStatus: (status: number) => `o site respondeu ${status}`,
  notAPage: (type: string) => `o link não é uma página (${type})`,
  noLocation: "não achei a localização na página (sem coordenada nem endereço)",
  titleFromUrl: (type: string, place: string) => `${type} em ${place}`,
  addressFromUrl: (address: string, reason: string) => `${address} (bairro — ${reason}; dados tirados do link)`,
};
