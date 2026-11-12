import type { City, Listing, Region, SourceId } from "../../shared/types.js";

export interface SearchArgs {
  city: Pick<City, "name" | "stateCode" | "bbox">;
  region: Pick<Region, "id" | "name" | "lat" | "lng" | "bbox">;
  max: number;
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
