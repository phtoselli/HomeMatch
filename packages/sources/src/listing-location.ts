import type { LatLng } from "@homematch/contracts";

/**
 * Where a listing page says the property is, without mistaking it for the agency. Agency sites print their office
 * address (and map) on every page: in schema.org (`RealEstateAgent`), in the app state (`imobiliaria.offices`) and in
 * the header/footer. These helpers skip all of that. Key names cover Brazilian sites (Portuguese) and English ones.
 */

export type Json = Record<string, unknown>;

export const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function validGeo(lat?: number, lng?: number): LatLng | undefined {
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

/** schema.org types of businesses and people (the agency, its offices, the broker): not the property. */
const ORG_TYPE = /(Organization|Agent|LocalBusiness|Corporation|Store|Office|Person)$/i;
/** schema.org keys that hold who sells or publishes, not what is for rent. */
const ORG_KEY =
  /^(seller|provider|offeredBy|publisher|author|brand|broker|agent|creator|sourceOrganization|parentOrganization)$/i;

/** schema.org objects, skipping organizations and whatever hangs from them. */
export function* walkSchema(v: unknown): Generator<Json> {
  if (Array.isArray(v)) for (const x of v) yield* walkSchema(x);
  else if (v && typeof v === "object") {
    const o = v as Json;
    const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (types.some((ty) => ORG_TYPE.test(ty))) return;
    yield o;
    for (const [k, x] of Object.entries(o)) if (x && typeof x === "object" && !ORG_KEY.test(k)) yield* walkSchema(x);
  }
}

/**
 * Parts of the app state about the agency or other listings (offices, footer, "similar listings"…). Agency sites on
 * Next.js/Nuxt carry the office address and dozens of other listings next to the one shown.
 */
const STATE_SKIP =
  /(imobiliaria|agenc|agency|office|filia|matriz|empresa|company|organi[sz]ation|corretor|broker|anunciante|advertiser|publisher|seller|footer|rodape|header|menu|similar|semelhante|relacionad|related|recomend|recommend|destaque|featured|outros|others|vitrine|banner|seo)/i;
/** Keys that make an object look like a listing. */
const LISTING_KEY =
  /^(preco|price|valor|aluguel|rent|dormitorios|quartos|bedrooms|banheiros|bathrooms|vagas|parking|area|codigo|listingId|tipoImovel|unitTypes|finalidade|condominio|iptu|suites)/i;
const LAT_KEY = /^(lat|latitude)$/i;
const LNG_KEY = /^(lng|lon|long|longitude)$/i;
const STREET_KEY = /^(endereco|logradouro|rua|street|streetName|streetAddress|address|addressLine1)$/i;
const NUMBER_KEY = /^(numero|number|streetNumber)$/i;
const DISTRICT_KEY = /^(bairro|neighbou?rhood|district)$/i;
const CITY_KEY = /^(cidade|city|municipio|addressLocality|locality)$/i;
const UF_KEY = /^(estado|uf|state|stateAcronym|addressRegion)$/i;
const PLACE_CHILD = /(locali[sz]ac|location|geo|coord|position|point|address|endereco)/i;

/** The value itself or, for a JSON string ("{\"lat\":…}"), what it holds. */
function parseMaybe(v: unknown): unknown {
  if (typeof v === "string" && /^\s*[{[]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "null" ? v.trim() : undefined);
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Coordinates on the object or on a child like `localizacao`, `location`, `geo`. */
function coordsOf(o: Json, depth = 0): LatLng | undefined {
  let lat: number | undefined;
  let lng: number | undefined;
  for (const [k, v] of Object.entries(o)) {
    if (LAT_KEY.test(k)) lat = num(v);
    else if (LNG_KEY.test(k)) lng = num(v);
  }
  const g = validGeo(lat, lng);
  if (g || depth >= 1) return g;
  for (const [k, v] of Object.entries(o)) {
    if (!PLACE_CHILD.test(k)) continue;
    const child = parseMaybe(v);
    if (isObj(child)) {
      const c = coordsOf(child, depth + 1);
      if (c) return c;
    }
  }
  return undefined;
}

/** Address of a listing-like object (street, number, district, city, state), on it or on an `address` child. */
function addressOf(o: Json): string | undefined {
  const pick = (re: RegExp, from: Json) => {
    for (const [k, v] of Object.entries(from)) if (re.test(k)) return text(v);
    return undefined;
  };
  let src = o;
  if (!pick(STREET_KEY, o)) {
    for (const [k, v] of Object.entries(o)) {
      const child = PLACE_CHILD.test(k) ? parseMaybe(v) : undefined;
      if (isObj(child) && pick(STREET_KEY, child)) {
        src = child;
        break;
      }
    }
  }
  const street = pick(STREET_KEY, src);
  if (!street || street.length < 4) return undefined;
  return [
    [street, pick(NUMBER_KEY, src)].filter(Boolean).join(", "),
    pick(DISTRICT_KEY, src) ?? pick(DISTRICT_KEY, o),
    pick(CITY_KEY, src) ?? pick(CITY_KEY, o),
    pick(UF_KEY, src) ?? pick(UF_KEY, o),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The listing in the page's app state (Next.js `__NEXT_DATA__`, Nuxt, `window.__INITIAL_STATE__`…): the object that
 * looks most like a listing (price, bedrooms, code…) and has coordinates or an address. Offices, footers and lists of
 * other listings are skipped.
 */
export function listingFromState(states: unknown[]): { geo?: LatLng; address?: string } {
  let best: { score: number; geo?: LatLng; address?: string } | undefined;
  const visit = (v: unknown, depth: number) => {
    if (depth > 12 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      // A long list is a search result or a carousel, not the page's listing.
      if (v.length <= 3) for (const x of v) visit(parseMaybe(x), depth + 1);
      return;
    }
    const o = v as Json;
    const listingKeys = Object.keys(o).filter((k) => LISTING_KEY.test(k)).length;
    if (listingKeys >= 2) {
      const geo = coordsOf(o);
      const address = addressOf(o);
      if (geo || address) {
        const score = listingKeys + (geo ? 3 : 0) + (address ? 2 : 0) - depth * 0.1;
        if (!best || score > best.score) best = { score, geo, address };
      }
    }
    for (const [k, x] of Object.entries(o)) if (!STATE_SKIP.test(k)) visit(parseMaybe(x), depth + 1);
  };
  for (const s of states) visit(s, 0);
  return best ? { geo: best.geo, address: best.address } : {};
}

/** JSON the page carries for its own app: framework state scripts and `window.__STATE__ = {…};` assignments. */
export function appStates(document: Document, html: string): unknown[] {
  const out: unknown[] = [];
  for (const s of document.querySelectorAll(
    'script[type="application/json"], script#__NEXT_DATA__, script#__NUXT_DATA__',
  )) {
    try {
      out.push(JSON.parse(s.textContent ?? ""));
    } catch {
      /* not JSON */
    }
  }
  for (const m of html.matchAll(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]{20,}?\})\s*;?\s*<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]!));
    } catch {
      /* not plain JSON */
    }
  }
  return out;
}

/**
 * The page body without what every page of the site repeats (header, menus, footer): that is where agencies put
 * their office address and map.
 */
export function mainHtml(document: Document): string {
  const root = document.querySelector("main") ?? document.body;
  if (!root) return "";
  const clone = root.cloneNode(true) as Element;
  for (const el of clone.querySelectorAll(
    'header, footer, nav, aside, script, style, noscript, [role="banner"], [role="contentinfo"], [role="navigation"]',
  ))
    el.remove();
  for (const el of clone.querySelectorAll("[class], [id]")) {
    const tag = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
    if (/(footer|rodape|navbar|topbar|site-header|cabecalho)/i.test(tag)) el.remove();
  }
  return clone.innerHTML;
}

/** "Rua X, 210", "Av. Y, nº 1200 - Bairro"… */
const STREET_IN_TEXT =
  /\b(?:Rua|R\.|Avenida|Av\.|Alameda|Al\.|Travessa|Estrada|Rodovia|Praça)\s+[A-ZÀ-Ý0-9][^,<>\n|]{2,70}?,\s*(?:n[º°o.]?\s*)?\d{1,5}(?:\s*[-–]\s*[A-ZÀ-Ý][^,<>\n|]{2,60})?/;

/** An address written in the page text (the body, not the header or footer). */
export function addressInText(html: string): string | undefined {
  const plain = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ");
  return plain.match(STREET_IN_TEXT)?.[0]?.trim();
}
