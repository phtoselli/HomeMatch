import { parseHTML } from "linkedom";
import { appStates, num, validGeo, type Json } from "../../listing-location.js";
import type { RawListing } from "./types.js";

/**
 * Listings from a search page's app state. Many agency website platforms (FlipCRM, Arbo, Imobzi… on Next.js or Nuxt)
 * render the results from a JSON state embedded in the page, without schema.org. Instead of one parser per
 * platform, this finds the list in that state: an array of objects that look like listings (price, bedrooms, code,
 * place) and maps the usual key names (Portuguese and English).
 */

const pick = (o: Json, keys: RegExp): unknown => {
  for (const [k, v] of Object.entries(o)) if (keys.test(k) && v != null && v !== "") return v;
  return undefined;
};
/** First value under a matching key that is a number (keys like "condominio" may also hold text). */
const numPick = (o: Json, keys: RegExp): number | undefined => {
  for (const [k, v] of Object.entries(o)) {
    if (!keys.test(k)) continue;
    const n = num(v);
    if (n != null) return n;
  }
  return undefined;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "null" ? v.trim() : undefined);
const int = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? Math.round(n) : undefined;
};
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** The object with its detail children (`detalhes`, `details`, `features`…) lifted to the top level. */
function flatten(o: Json): Json {
  const out: Json = { ...o };
  for (const [k, v] of Object.entries(o)) {
    if (!/^(detalhes|details|caracteristicasPrincipais|features|info|dados|attributes|valores|values|prices)$/i.test(k))
      continue;
    const child = typeof v === "string" && v.startsWith("{") ? safeJson(v) : v;
    if (isObj(child)) for (const [ck, cv] of Object.entries(child)) if (!(ck in out)) out[ck] = cv;
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const RENT = /^(precoLocacao|valorLocacao|valorAluguel|aluguel|rentPrice|rent|preco|price|valor)$/i;
const SALE_ONLY = /^(precoVenda|valorVenda|salePrice)$/i;
const BEDROOMS = /^(dormitorios|quartos|bedrooms|dorms|numeroQuartos)$/i;
const ID = /^(codigo|codigoImovel|referencia|reference|ref|listingId|id|slug)$/i;
const CODE_KEYS = /^(codigo|codigoImovel|referencia|reference|ref|listingId)$/i;

/** How much an object looks like a listing (0 = not one). */
function listingScore(o: Json): number {
  const f = flatten(o);
  const rent = numPick(f, RENT);
  let s = 0;
  if (rent != null && rent > 0) s += 2;
  if (pick(f, BEDROOMS) != null) s++;
  if (pick(f, CODE_KEYS) != null) s++;
  if (pick(f, /^(bairro|neighbou?rhood|endereco|address|lat|latitude|localizacao|location)$/i) != null) s++;
  if (pick(f, /^(area|areaUtil|areaTotal|usableArea|totalArea)$/i) != null) s++;
  return s >= 4 ? s : 0;
}

/** The longest list of listing-like objects in the state (search results, not a 3-item carousel). */
function findList(states: unknown[]): Json[] {
  let best: Json[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 14 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length >= 2 && objs.length > best.length) {
        const sample = objs.slice(0, 5);
        if (sample.filter((x) => listingScore(x) > 0).length >= Math.ceil(sample.length * 0.6)) best = objs;
      }
      for (const x of v.slice(0, 50)) visit(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Json)) {
      if (/(similar|semelhante|relacionad|related|destaque|featured|recomend|recommend)/i.test(k)) continue;
      visit(x, depth + 1);
    }
  };
  for (const s of states) visit(s, 0);
  return best;
}

/** Listing link: absolute URL, a path, or a slug (resolved under `detailPath`, "/imoveis/" by default). */
function linkOf(o: Json, pageUrl: string, detailPath: string): string | undefined {
  const raw = str(pick(o, /^(url|link|href|permalink|imovelUrl|urlImovel|path|canonical|slug)$/i));
  if (!raw) return undefined;
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith("/")) return new URL(raw, pageUrl).toString();
    return new URL(`${detailPath.replace(/\/?$/, "/")}${raw}`, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function imageOf(o: Json): string | undefined {
  const v = pick(
    o,
    /^(photo|thumbnail|thumb|image|imagem|foto|fotoPrincipal|fotoPrincipalUrl|thumbnailPrincipalUrl|cover|capa|photos|fotos|images|imagens)$/i,
  );
  if (typeof v === "string") return str(v);
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first === "string") return str(first);
  if (isObj(first)) return str(pick(first, /^(url|src|link|thumb|thumbnail)$/i));
  return undefined;
}

/** Pure parsing of a search page whose results live in the app state. */
export function parseStateListings(html: string, pageUrl: string, detailPath = "/imoveis/"): RawListing[] {
  const { document } = parseHTML(html);
  const list = findList(appStates(document as unknown as Document, html));
  const out: RawListing[] = [];
  for (const item of list) {
    const o = flatten(item);
    // A sale-only item in a mixed list: no rent to show.
    const rent = numPick(o, /^(precoLocacao|valorLocacao|valorAluguel|rentPrice)$/i) ?? numPick(o, RENT);
    if (!rent || rent <= 0) continue;
    // A sale-only item in a mixed list: its "price" is the sale price.
    if (numPick(o, SALE_ONLY) === rent && numPick(o, /^(precoLocacao|valorLocacao|valorAluguel|rentPrice)$/i) == null)
      continue;
    const url = linkOf(item, pageUrl, detailPath);
    const id = str(pick(o, CODE_KEYS)) ?? String(pick(o, ID) ?? url ?? "");
    if (!id || !url) continue;
    const geoSrc = pick(o, /^(localizacao|location|geo|coordinates|coordenadas|position)$/i);
    const geoObj = typeof geoSrc === "string" ? safeJson(geoSrc) : geoSrc;
    const geo =
      validGeo(num(pick(o, /^(lat|latitude)$/i)), num(pick(o, /^(lng|lon|long|longitude)$/i))) ??
      (isObj(geoObj)
        ? validGeo(num(pick(geoObj, /^(lat|latitude)$/i)), num(pick(geoObj, /^(lng|lon|long|longitude)$/i)))
        : undefined);
    const street = str(pick(o, /^(endereco|logradouro|rua|street|streetName|address)$/i));
    const number = str(pick(o, /^(numero|number|streetNumber)$/i));
    const condoFee = numPick(o, /^(valorCondominio|condominioValor|condoFee|condoPrice|condominio)$/i);
    const title = str(pick(o, /^(titulo|title|titulosPortais|name|nome)$/i));
    // "Apartamento para Alugar - Jardim Belo Horizonte, Campinas/ SP"
    const fromTitle = title?.match(/\s[-–]\s*([^,–-]{3,60}),\s*([^/,]{3,40})\s*\/\s*[A-Z]{2}\b/);
    out.push({
      id,
      url,
      title,
      typeLabel: str(pick(o, /^(tipoImovel|tipo|propertyType|type|categoria)$/i)),
      rent,
      condo: condoFee && condoFee > 0 ? condoFee : undefined,
      iptu: numPick(o, /^(iptu|valorIptu|iptuValor)$/i) || undefined,
      area: int(numPick(o, /^(areaUtil|usableArea|areaPrivativa|area|areaTotal|totalArea)$/i)),
      bedrooms: int(numPick(o, BEDROOMS)),
      bathrooms: int(numPick(o, /^(banheiros|bathrooms|baths)$/i)),
      parking: int(numPick(o, /^(vagas|garagens|parking|parkingSpaces|vagasGaragem)$/i)),
      street: street && number && !street.includes(number) ? `${street}, ${number}` : street,
      // Some platforms prefix the code ("Cód. 203876 Cambuí").
      neighbourhood: (str(pick(o, /^(bairro|neighbou?rhood|district)$/i)) ?? fromTitle?.[1]?.trim())?.replace(
        /^c[óo]d\.?\s*\d+\s*[-–]?\s*/i,
        "",
      ),
      cityName: str(pick(o, /^(cidade|city|municipio)$/i)) ?? fromTitle?.[2]?.trim(),
      geo,
      image: imageOf(o),
      description: str(pick(o, /^(descricao|description|resumo)$/i)),
    });
  }
  return out;
}
