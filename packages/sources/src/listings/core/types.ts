import type { LatLng } from "@homematch/contracts";
import type { SearchArgs } from "../types.js";

/**
 * A listing as the site shows it, before it becomes a `Listing`. Each extension only fills this in;
 * the engine (engine.ts) does the rest: total, type, amenities, map position and ids.
 */
export interface RawListing {
  /** Id on the site (the engine adds the source prefix). */
  id: string;
  url: string;
  title?: string;
  /** "Apartamento", "Casa de condomínio"… as the site says (without it, the type comes from the title). */
  typeLabel?: string;
  rent: number;
  condo?: number;
  iptu?: number;
  /** Monthly total when the site gives it; otherwise the engine adds rent + condo fee + tax. */
  total?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  street?: string;
  neighbourhood?: string;
  /** The property's city, when the site says (to drop listings from other cities). */
  cityName?: string;
  geo?: LatLng;
  image?: string;
  /** Listing text (to detect cabinets, sink…). */
  description?: string;
  /** Advertising agency (portals). */
  agency?: string;
}

/** What an extension receives to build the URL of a search page. */
export interface PageCtx extends Omit<SearchArgs, "log" | "max"> {
  /** 1, 2, 3… */
  page: number;
  /** Agency website (generic or platform extensions). */
  site?: string;
}

/**
 * A site extension: only what is specific to it (search URL and page parsing).
 * Fetching, pacing, cache, robots.txt, blocks, pagination and map position live in the engine.
 */
export interface SiteExtension {
  id: string;
  label: string;
  /** Home page (for robots.txt and to show in the source list). */
  home: string;
  /**
   * "region": the site searches by neighborhood (one search per region);
   * "city": the site only lists the whole city; the engine downloads it once (cached) and splits by region.
   */
  scope: "region" | "city";
  /** Listings per page (a page with fewer = the last one). */
  perPage: number;
  /** Page cap per search (be gentle with the site). */
  maxPages: number;
  /** Minimum interval between pages of the same site. */
  minIntervalMs?: number;
  /** URL of search page `ctx.page`, or null when there is none (unknown neighborhood etc.). */
  url(ctx: PageCtx): string | null;
  /** Next page from the current one (when the site uses "next" links instead of numbers). */
  next?(body: string, pageUrl: string, ctx: PageCtx): string | null;
  /** Pure page parsing (tested with a real fixture in test/fixtures). */
  parse(body: string, pageUrl: string): RawListing[];
}
