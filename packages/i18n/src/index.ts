/**
 * User-facing text for HomeMatch, as typed message catalogs.
 *
 * Code never embeds UI or API copy: it reads it from `t` (the active catalog). Messages that take values are
 * functions, so every call site is type-checked. To add a language, create `locales/<tag>/` with the same shape
 * (`Messages`) and register it in `CATALOGS`.
 */
import { ptBR } from "./locales/pt-BR/index.js";

export type Messages = typeof ptBR;
export type Locale = "pt-BR";

const CATALOGS: Record<Locale, Messages> = { "pt-BR": ptBR };

export const DEFAULT_LOCALE: Locale = "pt-BR";

/** BCP 47 tag for `Intl` formatting (numbers, money, dates, collation). */
export const LOCALE_TAG: string = DEFAULT_LOCALE;

/** Catalog of the active locale. */
export const t: Messages = CATALOGS[DEFAULT_LOCALE];

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale];
}

export { plural } from "./plural.js";
