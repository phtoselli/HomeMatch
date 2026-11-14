// Textos curtos em pt-BR (dinheiro, distância) usados nos rótulos do domínio e da tela.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const money = (n: number) => brl.format(n);

/** "R$ 3,2 mil": curto, para o marcador no mapa. */
export function moneyShort(n: number): string {
  if (n >= 1000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(n)}`;
}

export function meters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}
