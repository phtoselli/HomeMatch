import { parseHTML } from "linkedom";
import type { LatLng, Listing } from "../../shared/types.js";
import { padBBox } from "../geo.js";
import { BROWSER_UA, DAY, HOUR, cached, httpFetch } from "../http.js";
import { geocodeInBox } from "../osm/nominatim.js";
import { firstInt, normalizeType, parseBRL, slugify } from "./normalize.js";
import type { SourceAdapter } from "./types.js";

// VivaReal: página pública de busca por bairro. Os cards trazem preço, área, quartos e rua;
// a coordenada vem de geocodificar "rua, bairro, cidade" no Nominatim.
const SITE = "https://www.vivareal.com.br";
const PER_PAGE = 30;
const ZONES = ["zona-sul", "zona-oeste", "zona-norte", "zona-leste", "centro"];
const MAX_GEOCODES_PER_REGION = 40;

export interface VrCard {
  id: string;
  url: string;
  title: string;
  typeLabel: string;
  rent: number;
  condo?: number;
  iptu?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  street?: string;
  location?: string; // "Pinheiros, São Paulo"
  image?: string;
}

const cy = (el: Element, name: string) => el.querySelector(`[data-cy="${name}"]`)?.textContent?.trim() ?? "";

/** Parse puro do HTML de uma página de busca do VivaReal. */
export function parseVivaReal(html: string): VrCard[] {
  const { document } = parseHTML(html);
  const out: VrCard[] = [];
  for (const card of document.querySelectorAll('li[data-cy="rp-property-cd"]')) {
    const a = card.querySelector("a[href]");
    const href = a?.getAttribute("href") ?? "";
    const id = href.match(/id-(\d+)/)?.[1];
    if (!id) continue;
    const priceTxt = cy(card, "rp-cardProperty-price-txt");
    const rent = parseBRL(priceTxt.split("/")[0]);
    if (!rent) continue; // "sob consulta" ou sem preço: não dá para filtrar
    const title = (a?.getAttribute("title") ?? cy(card, "card-property-content")).replace(/\s+/g, " ").trim();
    const url = new URL(href, SITE);
    url.search = "";
    out.push({
      id,
      url: url.toString(),
      title,
      typeLabel: title.split(/ para (alugar|venda)/i)[0]!.trim() || "Imóvel",
      rent,
      condo: parseBRL(priceTxt.match(/Cond\.\s*R\$\s*[\d.,]+/i)?.[0]),
      iptu: parseBRL(priceTxt.match(/IPTU\s*R\$\s*[\d.,]+/i)?.[0]),
      area: firstInt(cy(card, "rp-cardProperty-propertyArea-txt")),
      bedrooms: firstInt(cy(card, "rp-cardProperty-bedroomQuantity-txt")),
      bathrooms: firstInt(cy(card, "rp-cardProperty-bathroomQuantity-txt")),
      parking: firstInt(cy(card, "rp-cardProperty-parkingSpacesQuantity-txt")),
      street: cy(card, "rp-cardProperty-street-txt") || undefined,
      location: cy(card, "rp-cardProperty-location-txt") || undefined,
      image: card.querySelector("img[src]")?.getAttribute("src") ?? undefined,
    });
  }
  return out;
}

async function getPage(url: string): Promise<{ status: number; html: string }> {
  return cached("vivareal", url, 6 * HOUR, async () => {
    const res = await httpFetch(url, {
      minIntervalMs: 2000,
      retries: 1,
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    // Bloqueio (403/429) não vai para o cache: é passageiro e não significa "bairro inexistente".
    if (res.status === 403 || res.status === 429) {
      throw new Error(`o VivaReal bloqueou a leitura automática (HTTP ${res.status}); tente mais tarde`);
    }
    return { status: res.status, html: res.ok ? await res.text() : "" };
  });
}

/** Descobre a URL de busca do bairro (cidades com zonas, como SP e RJ, usam /zona-x/ no caminho). */
async function resolveRegionUrl(uf: string, city: string, bairro: string): Promise<string | null> {
  const key = `${uf}/${city}/${bairro}`;
  return cached("vivareal-url", key, 30 * DAY, async () => {
    const candidates = [
      `${SITE}/aluguel/${uf}/${city}/bairros/${bairro}/`,
      ...ZONES.map((z) => `${SITE}/aluguel/${uf}/${city}/${z}/${bairro}/`),
    ];
    for (const url of candidates) {
      const { status, html } = await getPage(url);
      if (status === 200 && html.includes("rp-property-cd")) return url;
    }
    return null;
  });
}

/** Posição estável perto do centro da região quando o endereço não é encontrado. */
function jitter(center: LatLng, seed: string): LatLng {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * (Math.PI / 180);
  const r = 0.0015 + ((h >>> 9) % 100) / 100000;
  return { lat: center.lat + r * Math.sin(ang), lng: center.lng + r * Math.cos(ang) };
}

export const vivaReal: SourceAdapter = {
  id: "vivareal",
  label: "VivaReal",
  async search({ city, region, max, log }) {
    const uf = (city.stateCode ?? "").toLowerCase();
    const base = await resolveRegionUrl(uf, slugify(city.name), slugify(region.name));
    if (!base) {
      log(`VivaReal · ${region.name}: bairro não encontrado no site`);
      return [];
    }
    const cards: VrCard[] = [];
    for (let page = 1; cards.length < max && page <= Math.ceil(max / PER_PAGE); page++) {
      const { status, html } = await getPage(page === 1 ? base : `${base}?pagina=${page}`);
      if (status !== 200) break;
      const got = parseVivaReal(html);
      cards.push(...got);
      log(`VivaReal · ${region.name}: ${cards.length} anúncios`);
      if (got.length < PER_PAGE) break;
    }

    const box = padBBox(region.bbox, 1500);
    const geo = new Map<string, LatLng | null>();
    const out: Listing[] = [];
    for (const c of cards.slice(0, max)) {
      let pos: LatLng | null = null;
      if (c.street) {
        const q = `${c.street}, ${c.location ?? `${region.name}, ${city.name}`}`;
        if (!geo.has(q) && geo.size < MAX_GEOCODES_PER_REGION) geo.set(q, await geocodeInBox(q, box));
        pos = geo.get(q) ?? null;
      }
      const p = pos ?? jitter(region, c.id);
      out.push({
        id: `vivareal:${c.id}`,
        source: "vivareal",
        url: c.url,
        title: c.title,
        type: normalizeType(c.typeLabel),
        typeLabel: c.typeLabel,
        rent: c.rent,
        total: c.rent + (c.condo ?? 0) + (c.iptu ?? 0),
        condo: c.condo,
        iptu: c.iptu,
        area: c.area,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        parking: c.parking,
        address: [c.street, c.location].filter(Boolean).join(", "),
        neighbourhood: c.location?.split(",")[0],
        lat: p.lat,
        lng: p.lng,
        approxLocation: !pos,
        image: c.image,
      });
    }
    return out;
  },
};
