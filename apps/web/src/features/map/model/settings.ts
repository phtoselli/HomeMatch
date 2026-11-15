import { create } from "zustand";
import type { CellBand } from "@homematch/domain";
import { persistFields, readSaved } from "@/shared/lib/persist";

/** O que o mapa mostra (salvo no navegador). */
export interface MapSettings {
  /** Quadradinhos coloridos com a nota de cada área. */
  cells: boolean;
  cellBand: CellBand;
  /** Nomes numerados das melhores regiões. */
  badges: boolean;
  /** Linhas de ônibus que a análise usou para chegar ao trabalho. */
  routes: boolean;
  /** Linhas que você pediu pelo número (ex.: 353) e os pontos delas. */
  myLines: boolean;
  stops: boolean;
  /** Mercados, parques… (os escondidos ficam em hiddenPois). */
  pois: boolean;
  hiddenPois: string[];
  /** Linhas de ônibus escondidas (pelo número). */
  hiddenLines: string[];
  /** Imóveis da busca e links colados. */
  listings: boolean;
  myLinks: boolean;
  /** Limite da cidade e legenda. */
  boundary: boolean;
  legend: boolean;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  cells: true,
  cellBand: "both",
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

/** Configurações salvas de versões antigas (só 4 camadas) continuam valendo. */
export function normalizeMapSettings(s: Partial<MapSettings> | null | undefined): MapSettings {
  const out = { ...DEFAULT_MAP_SETTINGS, ...(s ?? {}) };
  if (!["great", "ok", "both"].includes(out.cellBand)) out.cellBand = "both";
  if (!Array.isArray(out.hiddenPois)) out.hiddenPois = [];
  if (!Array.isArray(out.hiddenLines)) out.hiddenLines = [];
  return out;
}

interface MapSettingsState {
  settings: MapSettings;
  setSettings: (s: MapSettings) => void;
  /** Esconde uma linha de ônibus (pelo número). */
  hideLine: (key: string) => void;
}

export const useMapSettings = create<MapSettingsState>()((set) => ({
  settings: normalizeMapSettings(readSaved<Partial<MapSettings> | null>("mapSettings", null)),
  setSettings: (s) => set({ settings: normalizeMapSettings(s) }),
  hideLine: (key) =>
    set(({ settings }) => ({ settings: { ...settings, hiddenLines: [...new Set([...settings.hiddenLines, key])] } })),
}));

persistFields(useMapSettings, { settings: "mapSettings" });
