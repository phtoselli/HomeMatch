import { parseSchemaOrgListings } from "../core/schemaorg.js";
import type { SiteExtension } from "../core/types.js";

/**
 * Extensão genérica para o site de uma imobiliária: lê a página de aluguel que a descoberta achou
 * (discovery.ts) e segue o link de "próxima página". Os anúncios saem do schema.org (JSON-LD),
 * que muitas plataformas de site de imobiliária publicam. A cidade toda vem de uma vez; o motor
 * separa por bairro.
 */
export interface AgencySite {
  id: string; // "site:gallinari.com.br"
  label: string;
  site: string; // https://gallinari.com.br
  listingsUrl: string; // página de aluguel
  platform?: string;
}

/** Link para a página seguinte: rel="next", ".../page/3/", "?pagina=3", "?page=3". */
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
    perPage: 1, // não sabemos o tamanho da página: para quando não vier nada novo ou não houver "próxima"
    maxPages: 8,
    minIntervalMs: 2000,
    url: ({ page }) => (page === 1 ? a.listingsUrl : null),
    next: (html, url, ctx) => findNextLink(html, url, ctx.page),
    parse: parseSchemaOrgListings,
  };
}
