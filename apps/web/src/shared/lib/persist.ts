import type { StoreApi } from "zustand";
import type { Listing } from "@homematch/contracts";
import {
  LEGACY_TRANSIT_CRITERION,
  TRANSIT_CRITERION,
  migrateAmenity,
  migrateFeatureId,
  migrateKeys,
  migrateLevel,
  migratePropertyType,
} from "@homematch/domain";

// Preferences saved in the browser (a convenience only: the search comes back as it was after a reload).
// Each field lives under its own key "homematch:<name>".

const PREFIX = "homematch:";
/** Prefix used by older versions; migrated once on startup so nobody loses favorites, filters or saved lines. */
const LEGACY_PREFIX = "mapa-aluguel:";

export function readSaved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeSaved(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* full or blocked: carry on without saving */
  }
}

/** Erases everything the app saved in this browser (search, priorities, favorites, links, lines and map). */
export function clearSaved(): void {
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith(PREFIX) || k.startsWith(LEGACY_PREFIX)) localStorage.removeItem(k);
  } catch {
    /* blocked: nothing to erase */
  }
}

/** Saves the chosen store fields whenever they change. `keys` gives the storage key of each field. */
export function persistFields<S>(store: StoreApi<S>, keys: Partial<Record<keyof S, string>>): void {
  store.subscribe((s, prev) => {
    for (const [field, key] of Object.entries(keys) as [keyof S, string][]) {
      if (s[field] !== prev[field]) writeSaved(key, s[field]);
    }
  });
}

// ---------- migration from older versions (Portuguese ids, old prefix) ----------

const migrateListing = (l: Listing): Listing => ({
  ...l,
  type: migratePropertyType(l.type),
  amenities: l.amenities?.map(migrateAmenity),
});
const migrateCriterion = (id: string) => (id === LEGACY_TRANSIT_CRITERION ? TRANSIT_CRITERION : migrateFeatureId(id));

/** How each saved value changes; keys not listed are copied as they are. */
const MIGRATIONS: Record<string, (v: never) => unknown> = {
  features: (v: Record<string, number>) => migrateKeys(v, migrateFeatureId),
  priorities: (v: Record<string, number>) => migrateKeys(v, migrateCriterion),
  minLevel: (v: string) => migrateLevel(v),
  favorites: (v: Record<string, Listing>) =>
    Object.fromEntries(Object.entries(v).map(([id, l]) => [id, migrateListing(l)])),
  links: (v: { listing?: Listing }[]) => v.map((r) => (r.listing ? { ...r, listing: migrateListing(r.listing) } : r)),
  mapSettings: (v: { hiddenPois?: string[] }) => ({ ...v, hiddenPois: v.hiddenPois?.map(migrateFeatureId) }),
};

/** Moves "mapa-aluguel:*" keys to "homematch:*", renaming legacy ids. Runs once; never throws. */
export function migrateLegacyStorage(): void {
  try {
    for (const legacyKey of Object.keys(localStorage)) {
      if (!legacyKey.startsWith(LEGACY_PREFIX)) continue;
      const key = legacyKey.slice(LEGACY_PREFIX.length);
      const raw = localStorage.getItem(legacyKey);
      localStorage.removeItem(legacyKey);
      if (raw == null || localStorage.getItem(PREFIX + key) != null) continue;
      try {
        const migrate = MIGRATIONS[key] as ((v: unknown) => unknown) | undefined;
        const value: unknown = JSON.parse(raw);
        localStorage.setItem(PREFIX + key, JSON.stringify(migrate ? migrate(value) : value));
      } catch {
        /* unreadable old value: drop it */
      }
    }
  } catch {
    /* storage blocked */
  }
}

// Runs before any store reads its saved state (stores import this module).
migrateLegacyStorage();
