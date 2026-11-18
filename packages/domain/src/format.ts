import { LOCALE_TAG, t } from "@homematch/i18n";

// Short localized texts (money, distance) used by domain and UI labels.

const currency = new Intl.NumberFormat(LOCALE_TAG, { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(LOCALE_TAG, { maximumFractionDigits: 1 });

export const money = (n: number) => currency.format(n);

/** Compact amount for map markers ("R$ 3,2 mil"). */
export function moneyShort(n: number): string {
  return n >= 1000 ? t.format.moneyThousands(decimal.format(n / 1000)) : t.format.money(Math.round(n));
}

export function meters(m: number): string {
  return m >= 1000 ? t.format.kilometers(decimal.format(m / 1000)) : t.format.meters(Math.round(m));
}
