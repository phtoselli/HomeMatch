import type { City, Listing, ListingFilters, Region, SourceId } from "../../shared/types.js";

export interface SearchArgs {
  city: Pick<City, "name" | "stateCode" | "bbox">;
  region: Pick<Region, "id" | "name" | "lat" | "lng" | "bbox">;
  max: number;
  /** Filtros do imóvel: quem puder, manda para o site; o servidor reaplica depois em todos. */
  filters?: ListingFilters;
  log: (message: string) => void;
}

/**
 * Uma imobiliária/portal. Para adicionar um site novo: crie `<site>.ts` com um parse puro
 * (testado com fixture em tests/listings) e um `search` que só busca e chama o parse.
 * Depois registre em listings/index.ts.
 */
export interface SourceAdapter {
  id: SourceId;
  label: string;
  search(args: SearchArgs): Promise<Listing[]>;
}

/** O site bloqueou a leitura automática (403/429/captcha): não adianta tentar as outras regiões agora. */
export class SourceBlockedError extends Error {}
