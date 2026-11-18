import { create } from "zustand";
import { persistFields, readSaved } from "@/shared/lib/persist";

/** What the map shows (saved in the browser). */
export interface MapSettings {
  /** Colored squares with each cell's level (excellent, good, ok). */
  cells: boolean;
  /** Numbered names of the best regions. */
  badges: boolean;
  /** Bus lines the analysis used to reach work. */
  routes: boolean;
  /** Lines the user requested by number (e.g. 353) and their stops. */
  myLines: boolean;
  stops: boolean;
  /** Groceries, parks… (hidden ones are in hiddenPois). */
  pois: boolean;
  hiddenPois: string[];
  /** Hidden bus lines (by number). */
  hiddenLines: string[];
  /** Search listings and pasted links. */
  listings: boolean;
  myLinks: boolean;
  /** City boundary and legend. */
  boundary: boolean;
  legend: boolean;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  cells: true,
  badges: true,
  routes: true,
  myLines: true,
  stops: true,
  pois: true,
  hiddenPois: [],
  hiddenLines: [],
  listings: true,
  myLinks: true,
  boundary: true,
  legend: true,
};

/** Settings saved by older versions (only 4 layers) still load. */
export function normalizeMapSettings(s: Partial<MapSettings> | null | undefined): MapSettings {
  const out = { ...DEFAULT_MAP_SETTINGS, ...(s ?? {}) };
  // Older versions had a score band (great/ok); the minimum level now lives in the search store.
  delete (out as Partial<MapSettings> & { cellBand?: unknown }).cellBand;
  if (!Array.isArray(out.hiddenPois)) out.hiddenPois = [];
  if (!Array.isArray(out.hiddenLines)) out.hiddenLines = [];
  return out;
}

interface MapSettingsState {
  settings: MapSettings;
  setSettings: (s: MapSettings) => void;
  /** Hides a bus line (by number). */
  hideLine: (key: string) => void;
}

export const useMapSettings = create<MapSettingsState>()((set) => ({
  settings: normalizeMapSettings(readSaved<Partial<MapSettings> | null>("mapSettings", null)),
  setSettings: (s) => set({ settings: normalizeMapSettings(s) }),
  hideLine: (key) =>
    set(({ settings }) => ({ settings: { ...settings, hiddenLines: [...new Set([...settings.hiddenLines, key])] } })),
}));

persistFields(useMapSettings, { settings: "mapSettings" });
