import { parseSchemaOrgListings } from "../core/schemaorg.js";
import type { SiteExtension } from "../core/types.js";

/**
 * Generic extension for an agency website: reads the rentals page that discovery found (discovery.ts) and follows
 * the "next page" link. Listings come from schema.org (JSON-LD), which many agency website platforms publish.
 * The whole city comes at once; the engine splits it by neighborhood.
 */
export interface AgencySite {
  id: string; // "site:gallinari.com.br"
  label: string;
  site: string; // https://gallinari.com.br
  listingsUrl: string; // rentals page
  platform?: string;
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

export function agencyExtension(a: AgencySite): SiteExtension {
  return {
    id: a.id,
    label: a.label,
    home: a.site,
    scope: "city",
    perPage: 1, // unknown page size: stop when nothing new comes or there is no "next"
    maxPages: 8,
    minIntervalMs: 2000,
    url: ({ page }) => (page === 1 ? a.listingsUrl : null),
    next: (html, url, ctx) => findNextLink(html, url, ctx.page),
    parse: parseSchemaOrgListings,
  };
}
