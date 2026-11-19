import { parseStateListings } from "../core/appstate.js";
import { parseListingCards } from "../core/cards.js";
import { sameName } from "../core/engine.js";
import { parseSchemaOrgListings } from "../core/schemaorg.js";
import type { RawListing, SiteExtension } from "../core/types.js";

/**
 * Generic extension for an agency website: reads the rentals page that discovery found (discovery.ts) and follows
 * the "next page" link. Listings come from schema.org (JSON-LD), which many agency website platforms publish, or
 * from the page's app state (sites on Next.js/Nuxt such as FlipCRM). When the sitemap lists one rentals page per
 * neighborhood, the region's page is read instead of the whole city's first page.
 */
export interface AgencySite {
  id: string; // "site:gallinari.com.br"
  label: string;
  site: string; // https://gallinari.com.br
  listingsUrl: string; // rentals page
  platform?: string;
  /** Rentals page per neighborhood (from the sitemap). */
  regionPages?: { name: string; url: string }[];
}

/**
 * Pure parsing of an agency's rentals page: the app state or schema.org, whichever brings more (the state usually
 * has the position and the rooms; some pages carry a bare schema.org list with only link and price), else the HTML
 * cards.
 */
export function parseAgencyPage(html: string, pageUrl: string): RawListing[] {
  const fromSchema = parseSchemaOrgListings(html, pageUrl);
  const fromState = parseStateListings(html, pageUrl);
  if (fromState.length && fromState.length >= fromSchema.length) return fromState;
  if (fromSchema.length) return fromSchema;
  return parseListingCards(html, pageUrl);
}

/** Link to the next page: rel="next", ".../page/3/", "?pagina=3", "?page=3". */
export function findNextLink(html: string, pageUrl: string, current: number): string | null {
  const want = current + 1;
  const rel = html.match(/<(?:link|a)\b[^>]*\brel=["']?next["']?[^>]*>/i)?.[0]?.match(/\bhref=["']?([^"' >]+)/i)?.[1];
  const hrefs = rel ? [rel] : [...html.matchAll(/\bhref=["']?([^"' >]+)/gi)].map((m) => m[1]!);
  const pattern = new RegExp(`(?:/page/${want}/?(?:[?#]|$)|[?&](?:pagina|page|pg|p)=${want}(?:&|#|$))`);
  const hit = rel ?? hrefs.find((h) => pattern.test(h.replace(/&amp;/g, "&")));
  if (!hit) return null;
  try {
    const u = new URL(hit.replace(/&amp;/g, "&"), pageUrl);
    return u.origin === new URL(pageUrl).origin ? u.toString() : null;
  } catch {
    return null;
  }
}

const titleCase = (s: string) => s.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());

export function agencyExtension(a: AgencySite): SiteExtension {
  return {
    id: a.id,
    label: a.label,
    home: a.site,
    scope: "city",
    perPage: 1, // unknown page size: stop when nothing new comes or there is no "next"
    maxPages: 8,
    minIntervalMs: 2000,
    url: ({ page, region }) => {
      if (page !== 1) return null;
      // The neighborhood's own page when the site has one ("Taquaral" ↔ "parque-taquaral").
      return a.regionPages?.find((p) => sameName(p.name, region.name))?.url ?? a.listingsUrl;
    },
    next: (html, url, ctx) => findNextLink(html, url, ctx.page),
    parse: (html, url) => {
      const items = parseAgencyPage(html, url);
      // On a neighborhood's own page, a listing that does not say its neighborhood is in that one.
      const region = a.regionPages?.find((p) => url.startsWith(p.url));
      return region ? items.map((r) => ({ ...r, neighbourhood: r.neighbourhood ?? titleCase(region.name) })) : items;
    },
  };
}
