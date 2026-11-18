import type { City, Listing, ListingFilters, Region } from "@homematch/contracts";

export interface SearchArgs {
  city: Pick<City, "name" | "stateCode" | "bbox">;
  region: Pick<Region, "id" | "name" | "lat" | "lng" | "bbox">;
  max: number;
  /** Property filters: sources that can, send them to the site; the server re-applies them to all. */
  filters?: ListingFilters;
  log: (message: string) => void;
}

/**
 * An agency/portal. To add a new site: create `<site>.ts` with pure parsing (tested with a fixture in
 * test/listings) and a `search` that only fetches and calls the parser. Then register it in listings/index.ts.
 */
export interface SourceAdapter {
  id: string;
  label: string;
  search(args: SearchArgs): Promise<Listing[]>;
}

/** The site blocked automated reads (403/429/captcha): no point trying the other regions now. */
export class SourceBlockedError extends Error {}
