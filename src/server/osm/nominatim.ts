import type { BBox, City, LatLng, PlaceResult, Polygon } from "../../shared/types.js";
import { DAY, cached, httpJson } from "../http.js";

// Política do Nominatim: no máximo 1 requisição/s e User-Agent identificando o app.
const BASE = "https://nominatim.openstreetmap.org";
const OPTS = { minIntervalMs: 1100, timeoutMs: 30_000, headers: { "Accept-Language": "pt-BR" } };

const UF: Record<string, string> = {
  Acre: "AC", Alagoas: "AL", Amapá: "AP", Amazonas: "AM", Bahia: "BA", Ceará: "CE",
  "Distrito Federal": "DF", "Espírito Santo": "ES", Goiás: "GO", Maranhão: "MA",
  "Mato Grosso": "MT", "Mato Grosso do Sul": "MS", "Minas Gerais": "MG", Pará: "PA",
  Paraíba: "PB", Paraná: "PR", Pernambuco: "PE", Piauí: "PI", "Rio de Janeiro": "RJ",
  "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS", Rondônia: "RO", Roraima: "RR",
  "Santa Catarina": "SC", "São Paulo": "SP", Sergipe: "SE", Tocantins: "TO",
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
    // Algumas cidades não vêm como "city": busca livre e fica com os limites municipais.
    // Brasília é só um nó; o "município" é o próprio Distrito Federal.
    const url2 = `${base}&q=${encodeURIComponent(q)}`;
    const all = await cached("nominatim", url2, 30 * DAY, () => httpJson<NomRow[]>(url2, OPTS));
    rows = all.filter(
      (r) => r.osm_type === "relation" && (CITY_TYPES.has(r.addresstype ?? r.type ?? "") || r.name === "Distrito Federal"),
    );
  }
  return rows.map(toPlace);
}

const STREET = String.raw`(?:R\.|Rua|Av\.?|Avenida|Al\.?|Alameda|Estr\.?|Estrada|Rod\.?|Rodovia|P[çc]\.?|Pra[çc]a|Tv\.?|Travessa|Lgo\.?|Largo|Via|Viela|Servid[ãa]o)`;

/**
 * Variações de um endereço colado (ex.: do Google Maps: "Empresa - R. X, 185 - Bairro, Cidade - SP, 13098-320"),
 * da mais completa para a mais simples. O Nominatim é exigente: nome da empresa, CEP ou "Lot." fazem a busca vir vazia.
 */
export function addressVariants(q: string): string[] {
  const out: string[] = [q.trim()];
  let s = q
    .replace(/\b\d{5}-?\d{3}\b/g, " ") // CEP
    .replace(/(?:^|[\s,])-\s*[A-Z]{2}\b/g, " ") // "- SP"
    .replace(/\s+/g, " ")
    .replace(/(\s*,\s*)+/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  // Descarta o que vem antes da rua (nome da empresa/prédio).
  const streetAt = s.search(new RegExp(String.raw`(?:^|[-,]\s*)${STREET}\s`, "i"));
  if (streetAt > 0) s = s.slice(streetAt).replace(/^[-,\s]+/, "");
  const parts = s.split(/\s+-\s+|,\s*/).map((p) => p.trim()).filter(Boolean);
  out.push(parts.join(", "));
  const m = s.match(new RegExp(String.raw`^(${STREET}\s[^,\-]+?)(?:,?\s*(?:n[º°o.]*\s*)?(\d+[A-Za-z]?))?(?=\s*(?:,|\s-\s|$))`, "i"));
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

/** Detalhes da cidade com o limite municipal (simplificado). */
export async function getCity(osmId: string): Promise<City> {
  const url = `${BASE}/lookup?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0005&osm_ids=${encodeURIComponent(osmId)}`;
  const rows = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow[]>(url, OPTS));
  const r = rows[0];
  if (!r) throw new Error(`Cidade ${osmId} não encontrada`);
  return { ...toPlace(r), boundary: toPolygons(r.geojson) };
}

async function searchAddressOnce(q: string, viewbox?: BBox): Promise<PlaceResult[]> {
  let url = `${BASE}/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=br&q=${encodeURIComponent(q)}`;
  if (viewbox) url += `&viewbox=${viewbox.west},${viewbox.north},${viewbox.east},${viewbox.south}&bounded=1`;
  const rows = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow[]>(url, OPTS));
  return rows.map(toPlace);
}

/** Busca um endereço tentando versões cada vez mais simples até achar algo (no máximo 5 consultas). */
export async function searchAddress(q: string, viewbox?: BBox): Promise<PlaceResult[]> {
  for (const v of addressVariants(q).slice(0, 5)) {
    const rows = await searchAddressOnce(v, viewbox);
    if (rows.length) return rows;
  }
  return [];
}

export async function reverse(p: LatLng): Promise<PlaceResult | null> {
  const url = `${BASE}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.lat.toFixed(6)}&lon=${p.lng.toFixed(6)}`;
  const row = await cached("nominatim", url, 30 * DAY, () => httpJson<NomRow | { error: string }>(url, OPTS));
  return "error" in row ? null : toPlace(row);
}

/** Geocodifica um endereço livre restrito a uma bbox; null se não achar. */
export async function geocodeInBox(q: string, box: BBox): Promise<LatLng | null> {
  const rows = await searchAddress(q, box).catch(() => []);
  const r = rows[0];
  return r ? { lat: r.lat, lng: r.lng } : null;
}
