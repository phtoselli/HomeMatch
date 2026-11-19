import { parseHTML } from "linkedom";
import { firstInt, parseBRL } from "../normalize.js";
import type { RawListing } from "./types.js";

/**
 * Last resort for agency sites without schema.org or app state (Union and other server-rendered platforms): the
 * listing cards of the results page. A card is the smallest block around a link to a property page that shows a
 * price. From its text come the rent, rooms, area and neighborhood ("Centro - Campinas/SP"). Text patterns are
 * Brazilian Portuguese, the language of the pages being read.
 */

/**
 * A single property's page, not a list: a code at the end ("AP3792_HH", "cod-215848", "13312829") or "/imovel/".
 */
export const isDetailPage = (u: string) => {
  const path = new URL(u).pathname.toLowerCase().replace(/\/$/, "");
  const last = path.split("/").filter(Boolean).at(-1) ?? "";
  return /\/imovel\//.test(path) || /(^|[-_])(cod-?)?[a-z]{0,4}\d{4,}(_[a-z]+)?$/.test(last) || /^\d{4,}$/.test(last);
};

const RENT_LABEL = /(loca[cç][aã]o|aluguel|alugar|mensal|\/m[eê]s)/i;
const SALE_LABEL = /\bvenda\b/i;

const rentLabeled = (text: string) => parseBRL(text.match(/(?:loca[cç][aã]o|aluguel)\s*:?\s*(R\$\s*[\d.,]+)/i)?.[1]);

/** "R$ 2.500,00" right after the rent label, else the first amount (the page is a rentals page). */
function rentIn(text: string): number | undefined {
  const labeled = text.match(/(?:loca[cç][aã]o|aluguel)\s*:?\s*(R\$\s*[\d.,]+)/i)?.[1];
  const amounts = [...text.matchAll(/R\$\s*[\d.,]+/g)].map((m) => m[0]);
  const raw = labeled ?? (SALE_LABEL.test(text) && !RENT_LABEL.test(text) ? undefined : amounts[0]);
  return raw ? parseBRL(raw) : undefined;
}

const count = (text: string, re: RegExp) => firstInt(text.match(re)?.[0]);

/** Text of an element with a space between its parts ("R$ 90.000,00" and "20 banheiros" must not touch). */
function spacedText(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.textContent ?? "");
    else if (n.nodeType === 1 && !/^(SCRIPT|STYLE)$/.test((n as Element).tagName))
      for (const c of n.childNodes) walk(c);
  };
  walk(el);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Pure parsing of a results page made of HTML cards. */
export function parseListingCards(html: string, pageUrl: string): RawListing[] {
  const { document } = parseHTML(html);
  const origin = new URL(pageUrl).origin;
  const out = new Map<string, RawListing>();
  for (const a of document.querySelectorAll("a[href]")) {
    let url: string;
    try {
      const u = new URL(a.getAttribute("href")!.replace(/&amp;/g, "&"), pageUrl);
      if (u.origin !== origin) continue;
      u.search = "";
      u.hash = "";
      url = u.toString().replace(/\/$/, "");
    } catch {
      continue;
    }
    if (out.has(url) || !isDetailPage(url)) continue;
    // Climb to the card: the first block with a price that does not hold another property's link.
    let card: Element | null = a as unknown as Element;
    for (let i = 0; card && i < 8 && !/R\$\s*\d/.test(card.textContent ?? ""); i++) card = card.parentElement;
    if (!card) continue;
    const others = [...card.querySelectorAll("a[href]")].some((x) => {
      try {
        const u = new URL(x.getAttribute("href")!, pageUrl);
        u.search = "";
        return isDetailPage(u.toString()) && u.toString().replace(/\/$/, "") !== url;
      } catch {
        return false;
      }
    });
    if (others) continue;
    const text = spacedText(card);
    // "Buy or rent" cards show the sale price first: only the rent counts.
    const rent = /comprar|venda/i.test(new URL(url).pathname) ? rentLabeled(text) : rentIn(text);
    if (!rent || rent < 100) continue;
    const heading = card.querySelector("h1, h2, h3, h4, h5, [class*='titulo' i], [class*='title' i]");
    const title = heading?.textContent?.replace(/\s+/g, " ").trim() || undefined;
    // "Centro - Campinas/SP", "Cambuí, Campinas - SP"
    const place = text.match(/([A-ZÀ-Ý][\wÀ-ú'. ]{2,50}?)\s*[-–,]\s*([A-ZÀ-Ý][\wÀ-ú'. ]{2,40}?)\s*[/-]\s*([A-Z]{2})\b/);
    const img = card.querySelector("img[src], img[data-src]");
    const id = url.split("/").filter(Boolean).at(-1)!;
    out.set(url, {
      id,
      url,
      title,
      typeLabel: title && title.length <= 40 ? title.charAt(0) + title.slice(1).toLowerCase() : undefined,
      rent,
      condo: parseBRL(text.match(/condom[íi]nio\s*:?\s*(R\$\s*[\d.,]+)/i)?.[1]),
      iptu: parseBRL(text.match(/iptu\s*:?\s*(R\$\s*[\d.,]+)/i)?.[1]),
      area: count(text, /\d+(?:[.,]\d+)?\s*m(²|2)\b/i),
      bedrooms: count(text, /\d+\s*(quartos?|dormit[óo]rios?|dorms?\b)/i),
      bathrooms: count(text, /\d+\s*banheiros?/i),
      parking: count(text, /\d+\s*vagas?/i),
      neighbourhood: place?.[1]?.trim(),
      cityName: place?.[2]?.trim(),
      image: img?.getAttribute("src") ?? img?.getAttribute("data-src") ?? undefined,
    });
  }
  return [...out.values()];
}
