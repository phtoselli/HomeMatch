import { parseHTML } from "linkedom";
import { firstInt, parseBRL, slugify } from "../normalize.js";
import type { RawListing, SiteExtension } from "../core/types.js";

/**
 * OLX: the public search is per city (not per neighborhood) and cards name the neighborhood but not coordinates.
 * The engine downloads the city once (cached) and keeps in each region only the listings of its neighborhood,
 * placed at the neighborhood center (approximate position).
 */
const SITE = "https://www.olx.com.br";

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** Pure parsing of an OLX search page. */
export function parseOlx(html: string): RawListing[] {
  const { document } = parseHTML(html);
  const out: RawListing[] = [];
  for (const card of document.querySelectorAll("section.olx-adcard")) {
    const a = card.querySelector('a[data-testid="adcard-link"], a.olx-adcard__link');
    const href = a?.getAttribute("href");
    const id = href?.match(/-(\d{6,})(?:[/?#]|$)/)?.[1];
    if (!href || !id) continue;
    const rent = parseBRL(text(card.querySelector(".olx-adcard__price")));
    if (!rent) continue;
    const infos = [...card.querySelectorAll(".olx-adcard__price-info")].map(text);
    const detail = (re: RegExp) =>
      firstInt(
        [...card.querySelectorAll(".olx-adcard__detail")]
          .map((d) => d.getAttribute("aria-label") ?? "")
          .find((s) => re.test(s)),
      );
    const title = a?.getAttribute("title") ?? text(a);
    // "Campinas, Vila Brandina"
    const [cityName, ...rest] = text(card.querySelector(".olx-adcard__location"))
      .split(",")
      .map((s) => s.trim());
    out.push({
      id,
      url: href.split("?")[0]!,
      title,
      typeLabel: title.split(" - ")[0],
      rent,
      condo: parseBRL(infos.find((s) => /condom/i.test(s))),
      iptu: parseBRL(infos.find((s) => /iptu/i.test(s))),
      area: detail(/metro/i),
      bedrooms: detail(/quarto/i),
      bathrooms: detail(/banheiro/i),
      parking: detail(/vaga/i),
      neighbourhood: rest.join(", ") || undefined,
      cityName: cityName || undefined,
      image: card.querySelector("img[src]")?.getAttribute("src") ?? undefined,
    });
  }
  return out;
}

export const olx: SiteExtension = {
  id: "olx",
  label: "OLX",
  home: SITE,
  scope: "city",
  perPage: 50,
  maxPages: 5,
  minIntervalMs: 2500,
  url: ({ city, page }) =>
    city.stateCode
      ? `${SITE}/imoveis/aluguel/estado-${city.stateCode.toLowerCase()}/${slugify(city.name)}${page > 1 ? `?o=${page}` : ""}`
      : null,
  parse: (html) => parseOlx(html),
};
