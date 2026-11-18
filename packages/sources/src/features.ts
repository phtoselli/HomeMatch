import type { BBox, FeatureDef, Poi } from "@homematch/contracts";
import { t } from "@homematch/i18n";
import { DAY } from "./http.js";
import { bboxQL, elementPoint, overpass, type OsmElement } from "./osm/overpass.js";

/**
 * Brazilian wholesale / hypermarket chains (monthly shopping at good prices).
 * Matched against name OR brand, case-insensitive. Adjust as needed.
 */
export const BULK_MARKET_REGEX =
  "atacad|atakarejo|atacarejo|assa[ií]|rold[aã]o|makro|sam.?s club|mart minas|spani|kompr[aã]o|carrefour|hiper|bistek|giassi|guanabara|savegnago|tauste|enxuto|mateus|tenda|fort atac|max atac|super muffato|comper|cometa";

type FeatureId = keyof typeof t.features;

interface FeatureSpec {
  id: FeatureId;
  emoji: string;
  color: string;
  /** Meters. */
  defaultRadius: number;
  /** Overpass QL selectors (without the bbox). Each becomes `<selector>(bbox);`. */
  selectors: string[];
  keep?: (e: OsmElement) => boolean;
}

/** Names that look like parks in OSM but are squares, roundabouts or medians (Portuguese, as mapped in Brazil). */
const NOT_A_PARK = /^(pra[çc]a|largo|canteiro|rotat[óo]ria|r[óo]tula|balão)\b/i;

const SPECS: FeatureSpec[] = [
  {
    id: "wholesale_market",
    emoji: "🛒",
    color: "#e8590c",
    defaultRadius: 2000,
    selectors: [
      `nwr["shop"~"^(supermarket|wholesale)$"]["name"~"${BULK_MARKET_REGEX}",i]`,
      `nwr["shop"~"^(supermarket|wholesale)$"]["brand"~"${BULK_MARKET_REGEX}",i]`,
      `nwr["shop"="wholesale"]`,
    ],
  },
  { id: "supermarket", emoji: "🧺", color: "#f08c00", defaultRadius: 800, selectors: [`nwr["shop"="supermarket"]`] },
  {
    id: "park",
    emoji: "🌳",
    color: "#2f9e44",
    defaultRadius: 1500,
    selectors: [`nwr["leisure"~"^(park|nature_reserve)$"]["name"]`],
    keep: (e) => !NOT_A_PARK.test(e.tags?.name ?? ""),
  },
  {
    id: "street_market",
    emoji: "🥬",
    color: "#66a80f",
    defaultRadius: 1500,
    selectors: [`nwr["amenity"="marketplace"]`, `nwr["shop"="greengrocer"]`],
  },
  { id: "gym", emoji: "🏋️", color: "#c2255c", defaultRadius: 1000, selectors: [`nwr["leisure"="fitness_centre"]`] },
  { id: "pharmacy", emoji: "💊", color: "#1971c2", defaultRadius: 800, selectors: [`nwr["amenity"="pharmacy"]`] },
  { id: "bakery", emoji: "🥖", color: "#a0522d", defaultRadius: 600, selectors: [`nwr["shop"~"^(bakery|pastry)$"]`] },
  {
    id: "hospital",
    emoji: "🏥",
    color: "#e03131",
    defaultRadius: 3000,
    selectors: [`nwr["amenity"~"^(hospital|clinic)$"]`],
  },
  {
    id: "school",
    emoji: "🏫",
    color: "#7048e8",
    defaultRadius: 1000,
    selectors: [`nwr["amenity"~"^(school|kindergarten)$"]`],
  },
  { id: "mall", emoji: "🛍️", color: "#ae3ec9", defaultRadius: 3000, selectors: [`nwr["shop"="mall"]`] },
  {
    id: "pet",
    emoji: "🐾",
    color: "#0c8599",
    defaultRadius: 1500,
    selectors: [`nwr["shop"="pet"]`, `nwr["amenity"="veterinary"]`],
  },
  {
    id: "station",
    emoji: "🚇",
    color: "#364fc7",
    defaultRadius: 1000,
    selectors: [`nwr["railway"~"^(station|halt)$"]`, `nwr["public_transport"="station"]["bus"!="yes"]`],
  },
  {
    id: "university",
    emoji: "🎓",
    color: "#5c940d",
    defaultRadius: 3000,
    selectors: [`nwr["amenity"~"^(university|college)$"]`],
  },
];

export const FEATURES: FeatureDef[] = SPECS.map(({ selectors: _s, keep: _k, ...def }) => ({
  ...def,
  label: t.features[def.id].label,
  description: t.features[def.id].description,
}));

export function featureById(id: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}

export function buildFeatureQuery(id: string, bbox: BBox): string {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown feature: ${id}`);
  const bb = bboxQL(bbox);
  // `out center` (full body): nodes with lat/lon, ways/relations with their center. Do not use `out tags`,
  // which drops the coordinates.
  return `[out:json][timeout:180];(${spec.selectors.map((s) => `${s}(${bb});`).join("")});out center qt;`;
}

export function parseFeaturePois(id: string, elements: OsmElement[]): Poi[] {
  const spec = SPECS.find((s) => s.id === id);
  const out: Poi[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    if (spec?.keep && !spec.keep(e)) continue;
    const p = elementPoint(e);
    if (!p) continue;
    const key = `${e.type}${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, feature: id, lat: p.lat, lng: p.lng, name: e.tags?.name ?? e.tags?.brand });
  }
  return out;
}

export async function fetchFeaturePois(id: string, bbox: BBox): Promise<Poi[]> {
  const res = await overpass(buildFeatureQuery(id, bbox));
  return parseFeaturePois(id, res.elements);
}

export interface PlaceName {
  lat: number;
  lng: number;
  name: string;
  /** Lower = more of a neighborhood: official neighborhoods and suburbs before developments and condos. */
  rank: number;
}

const PLACE_RANK: Record<string, number> = { suburb: 0, quarter: 1, neighbourhood: 2, hamlet: 3, village: 3 };

/**
 * Neighborhoods that name the regions. Two queries: neighborhood points (place=suburb/quarter/neighbourhood) and
 * named areas (official neighborhoods as administrative boundaries, developments/residential areas, villages,
 * hamlets), which cover cities with almost no neighborhood points mapped. If the second fails, the first still serves.
 */
export async function fetchPlaceNames(bbox: BBox): Promise<PlaceName[]> {
  const [points, areas] = await Promise.all([
    overpass(buildPlacePointsQuery(bbox), 30 * DAY),
    overpass(buildPlaceAreasQuery(bbox), 30 * DAY).catch(() => ({ elements: [] as OsmElement[] })),
  ]);
  return parsePlaceNames([...points.elements, ...areas.elements]);
}

export const buildPlacePointsQuery = (bbox: BBox) =>
  `[out:json][timeout:120];(node["place"~"^(suburb|quarter|neighbourhood)$"]["name"](${bboxQL(bbox)}););out qt;`;

export const buildPlaceAreasQuery = (bbox: BBox) => {
  const b = bboxQL(bbox);
  return (
    `[out:json][timeout:120];(` +
    `node["place"~"^(hamlet|village)$"]["name"](${b});` +
    `way["landuse"="residential"]["name"](${b});` +
    `way["place"~"^(suburb|quarter|neighbourhood)$"]["name"](${b});` +
    `rel["boundary"="administrative"]["admin_level"~"^(9|10)$"]["name"](${b});` +
    `);out center tags qt;`
  );
};

/** Pure parsing: point or center of each named place and its neighborhood rank. */
export function parsePlaceNames(elements: OsmElement[]): PlaceName[] {
  const out: PlaceName[] = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    const p = elementPoint(e);
    if (!p || !tags.name) continue;
    const rank =
      tags.boundary === "administrative"
        ? 0 // official neighborhood (city hall boundary)
        : tags.place
          ? (PLACE_RANK[tags.place] ?? 3)
          : tags.landuse === "residential"
            ? 2.5 // development, gated community, housing project
            : 3;
    out.push({ ...p, name: tags.name, rank });
  }
  return out;
}
