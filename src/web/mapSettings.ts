import type { Cell } from "../shared/types";

/** Quais notas de região pintar no mapa. */
export type CellBand = "great" | "ok" | "both";

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

/**
 * A partir de que nota a área é "ótima": o terço de cima entre as áreas que atendem a tudo
 * (as que só chegam perto, na busca flexível, ficam como "ok").
 */
export function greatThreshold(cells: Cell[]): number {
  const scores = cells.filter((c) => !c.misses).map((c) => c.score).sort((a, b) => a - b);
  if (!scores.length) return Infinity;
  return scores[Math.floor(scores.length * (2 / 3))] ?? scores[scores.length - 1]!;
}

export const bandOf = (c: Cell, threshold: number): Exclude<CellBand, "both"> => (!c.misses && c.score >= threshold ? "great" : "ok");

export const showCell = (c: Cell, band: CellBand, threshold: number) => band === "both" || bandOf(c, threshold) === band;
