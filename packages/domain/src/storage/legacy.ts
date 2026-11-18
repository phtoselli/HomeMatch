import type { AmenityId, PropertyType, RegionLevel } from "@homematch/contracts";

/**
 * Values saved by older versions (Portuguese ids). Browsers keep them in localStorage, so each loader maps them to
 * the current ids instead of dropping the user's favorites, filters and priorities.
 */
export const LEGACY_PROPERTY_TYPES: Record<string, PropertyType> = {
  apartamento: "apartment",
  casa: "house",
  casa_condominio: "condo_house",
  outro: "other",
};

export const LEGACY_AMENITIES: Record<string, AmenityId> = {
  armario_cozinha: "kitchen_cabinets",
  armario_quarto: "wardrobe",
  pia: "sink",
  mobiliado: "furnished",
};

export const LEGACY_FEATURES: Record<string, string> = {
  atacarejo: "wholesale_market",
  supermercado: "supermarket",
  parque: "park",
  feira: "street_market",
  academia: "gym",
  farmacia: "pharmacy",
  padaria: "bakery",
  escola: "school",
  estacao: "station",
  universidade: "university",
};

export const LEGACY_LEVELS: Record<string, RegionLevel> = { boa: "good", excelente: "excellent" };

/** Old transit criterion id. */
export const LEGACY_TRANSIT_CRITERION = "transporte";

const mapValue =
  <T extends string>(map: Record<string, T>) =>
  (v: string) =>
    (map[v] ?? v) as T;

export const migratePropertyType = mapValue(LEGACY_PROPERTY_TYPES);
export const migrateAmenity = mapValue(LEGACY_AMENITIES);
export const migrateFeatureId = mapValue(LEGACY_FEATURES);
export const migrateLevel = mapValue(LEGACY_LEVELS);

/** Renames the keys of a record saved by an older version (e.g. `{ parque: 1500 }` → `{ park: 1500 }`). */
export function migrateKeys<V>(record: Record<string, V>, rename: (key: string) => string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [rename(k), v]));
}
