import type { BBox, City, LatLng, PlaceResult, Polygon } from "@homematch/contracts";
import { padBBox } from "@homematch/domain";
import { DAY, cached, httpJson } from "../http.js";
import { t } from "@homematch/i18n";

// Nominatim policy: at most 1 request/s and a User-Agent identifying the app.
const BASE = "https://nominatim.openstreetmap.org";
const OPTS = { minIntervalMs: 1100, timeoutMs: 30_000, headers: { "Accept-Language": "pt-BR" } };

/** Brazilian state names as Nominatim returns them → two-letter codes. */
const UF: Record<string, string> = {
  Acre: "AC",
  Alagoas: "AL",
  Amapá: "AP",
  Amazonas: "AM",
  Bahia: "BA",
  Ceará: "CE",
  "Distrito Federal": "DF",
  "Espírito Santo": "ES",
  Goiás: "GO",
  Maranhão: "MA",
  "Mato Grosso": "MT",
  "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG",
  Pará: "PA",
  Paraíba: "PB",
  Paraná: "PR",
  Pernambuco: "PE",
  Piauí: "PI",
  "Rio de Janeiro": "RJ",
  "Rio Grande do Norte": "RN",
  "Rio Grande do Sul": "RS",
  Rondônia: "RO",
  Roraima: "RR",
  "Santa Catarina": "SC",
  "São Paulo": "SP",
  Sergipe: "SE",
  Tocantins: "TO",
};

interface NomRow {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  boundingbox: [string, string, string, string]; // south, north, west, east
  addresstype?: string;
  type?: string;
  address?: Record<string, string>;
  geojson?: { type: string; coordinates: unknown };
}

function toPlace(r: NomRow): PlaceResult {
  const [s, n, w, e] = r.boundingbox.map(Number) as [number, number, number, number];
  const a = r.address ?? {};
  const state = a.state;
  const stateCode = a["ISO3166-2-lvl4"]?.split("-")[1] ?? (state ? UF[state] : undefined);
  return {
    osmId: `${r.osm_type[0]!.toUpperCase()}${r.osm_id}`,
    name: r.name || r.display_name.split(",")[0]!,
    displayName: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    bbox: { south: s, north: n, west: w, east: e },
    kind: r.addresstype ?? r.type ?? "place",
    city: a.city ?? a.town ?? a.municipality ?? a.village,
    state,
    stateCode,
  };
}

function toPolygons(g: NomRow["geojson"]): Polygon[] | undefined {
  if (!g) return undefined;
  if (g.type === "Polygon") return [g.coordinates as Polygon];
  if (g.type === "MultiPolygon") return g.coordinates as Polygon[];
  return undefined;
}

const CITY_TYPES = new Set(["city", "town", "municipality", "village", "administrative"]);

export async function searchCities(q: string): Promise<PlaceResult[]> {
  const base = `${BASE}/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=br`;
  const url = `${base}&featureType=city&q=${encodeURIComponent(q)}`;
  let rows = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow[]>(url, OPTS));
  rows = rows.filter((r) => r.osm_type === "relation");
  if (!rows.length) {
    // Some cities do not come back as "city": run a free search and keep municipal boundaries.
    // Brasília is only a node; its "municipality" is the Federal District itself.
    const url2 = `${base}&q=${encodeURIComponent(q)}`;
    const all = await cached("nominatim", url2, 30 * DAY, () => httpJson<NomRow[]>(url2, OPTS));
    rows = all.filter(
      (r) =>
        r.osm_type === "relation" && (CITY_TYPES.has(r.addresstype ?? r.type ?? "") || r.name === "Distrito Federal"),
    );
  }
  return rows.map(toPlace);
}

/** Street type words in Brazilian addresses ("Rua", "Av.", "Rodovia"…). */
const STREET = String.raw`(?:R\.|Rua|Av\.?|Avenida|Al\.?|Alameda|Estr\.?|Estrada|Rod\.?|Rodovia|P[çc]\.?|Pra[çc]a|Tv\.?|Travessa|Lgo\.?|Largo|Via|Viela|Servid[ãa]o)`;

/**
 * Variations of a pasted address (e.g. from Google Maps: "Company - R. X, 185 - District, City - SP, 13098-320"),
 * from the most complete to the simplest. Nominatim is strict: a company name, postal code or "Lot." empties results.
 */
export function addressVariants(q: string): string[] {
  const out: string[] = [q.trim()];
  let s = q
    .replace(/\b\d{5}-?\d{3}\b/g, " ") // CEP
    .replace(/(?:^|[\s,])-\s*[A-Z]{2}\b/g, " ") // "- SP"
    .replace(/\s+/g, " ")
    .replace(/(\s*,\s*)+/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  // Drop what comes before the street (company/building name).
  const streetAt = s.search(new RegExp(String.raw`(?:^|[-,]\s*)${STREET}\s`, "i"));
  if (streetAt > 0) s = s.slice(streetAt).replace(/^[-,\s]+/, "");
  const parts = s
    .split(/\s+-\s+|,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  out.push(parts.join(", "));
  const m = s.match(
    new RegExp(String.raw`^(${STREET}\s[^,\-]+?)(?:,?\s*(?:n[º°o.]*\s*)?(\d+[A-Za-z]?))?(?=\s*(?:,|\s-\s|$))`, "i"),
  );
  if (m) {
    const street = m[1]!.trim();
    const rest = parts.slice(m[2] ? 2 : 1).filter((p) => !/^(lot|jd|jardim|vila|vl|res|cond|parque|pq)\b/i.test(p));
    const city = rest.at(-1);
    if (m[2] && city) out.push(`${street}, ${m[2]}, ${city}`);
    if (m[2]) out.push(`${street}, ${m[2]}`);
    if (city) out.push(`${street}, ${city}`);
    out.push(street);
  }
  return [...new Set(out.filter((v) => v.length >= 3))];
}

/** City details with its (simplified) municipal boundary. */
export async function getCity(osmId: string): Promise<City> {
  const url = `${BASE}/lookup?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0005&osm_ids=${encodeURIComponent(osmId)}`;
  const rows = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow[]>(url, OPTS));
  const r = rows[0];
  if (!r) throw new Error(t.sources.cityNotFound(osmId));
  return { ...toPlace(r), boundary: toPolygons(r.geojson) };
}

async function searchAddressOnce(q: string, viewbox?: BBox): Promise<PlaceResult[]> {
  let url = `${BASE}/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=br&q=${encodeURIComponent(q)}`;
  if (viewbox) url += `&viewbox=${viewbox.west},${viewbox.north},${viewbox.east},${viewbox.south}&bounded=1`;
  const rows = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow[]>(url, OPTS));
  return rows.map(toPlace);
}

/** Searches an address trying simpler and simpler versions until something is found (at most 5 queries). */
async function searchAddressIn(q: string, viewbox?: BBox, variants = 5): Promise<PlaceResult[]> {
  for (const v of addressVariants(q).slice(0, variants)) {
    const rows = await searchAddressOnce(v, viewbox);
    if (rows.length) return rows;
  }
  return [];
}

/** How far work may be from the city chosen to live in (metropolitan area). */
export const WORK_REACH_M = 80_000;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const inBox = (p: LatLng, b: BBox) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

/** Results in the city written in the address first; then those inside the chosen city; the rest last. */
export function rankAddresses(rows: PlaceResult[], q: string, home: BBox): PlaceResult[] {
  const fq = fold(q);
  const score = (r: PlaceResult) => (r.city && fq.includes(fold(r.city)) ? 0 : inBox(r, home) ? 1 : 2);
  return rows
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Work address. Searches first inside the city where the user wants to live (as typed); otherwise in the area
 * around it, because work may be in another city ("Av. Norte-Sul, 500, Campinas" while living in Cosmópolis).
 */
export async function searchAddress(q: string, home?: BBox): Promise<PlaceResult[]> {
  if (!home) return searchAddressIn(q);
  const inCity = await searchAddressIn(q, home, 2);
  if (inCity.length) return inCity;
  return rankAddresses(await searchAddressIn(q, padBBox(home, WORK_REACH_M)), q, home);
}

export async function reverse(p: LatLng): Promise<PlaceResult | null> {
  const url = `${BASE}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.lat.toFixed(6)}&lon=${p.lng.toFixed(6)}`;
  const row = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow | { error: string }>(url, OPTS));
  return "error" in row ? null : toPlace(row);
}

/** City (municipality) containing a point, with its boundary. null when the point is in no city. */
export async function cityAt(p: LatLng): Promise<City | null> {
  const url = `${BASE}/reverse?format=jsonv2&addressdetails=1&zoom=10&lat=${p.lat.toFixed(5)}&lon=${p.lng.toFixed(5)}`;
  const row = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow | { error: string }>(url, OPTS));
  if ("error" in row || row.osm_type !== "relation") return null;
  return getCity(`R${row.osm_id}`);
}

/** Geocodes a free-form address restricted to a bbox; null when not found. */
export async function geocodeInBox(q: string, box: BBox): Promise<LatLng | null> {
  const rows = await searchAddressIn(q, box).catch(() => []);
  const r = rows[0];
  return r ? { lat: r.lat, lng: r.lng } : null;
}
