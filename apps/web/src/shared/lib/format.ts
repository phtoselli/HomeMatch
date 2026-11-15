// Apresentação que só a tela usa (dinheiro e distância vêm de @homematch/domain).

/** Cor da nota (0..100): amarelo → verde. */
import type { RegionLevel } from "@homematch/contracts";

/** Cor de cada nível de região (mapa, legenda e etiquetas). */
export const LEVEL_COLOR: Record<RegionLevel, string> = {
  excelente: "hsl(140 70% 38%)",
  boa: "hsl(95 65% 45%)",
  ok: "hsl(42 85% 52%)",
};

export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100));
  const hue = 45 + t * 95;
  const light = 58 - t * 18;
  return `hsl(${hue.toFixed(0)} 75% ${light.toFixed(0)}%)`;
}

const SOURCE_LABEL: Record<string, string> = { quintoandar: "QuintoAndar", vivareal: "VivaReal", outro: "Link" };

/** Nome da fonte para mostrar: o que o servidor mandou, ou o nome conhecido. */
export const sourceName = (l: { source: string; sourceLabel?: string }, fallback = "site") =>
  l.sourceLabel ?? SOURCE_LABEL[l.source] ?? fallback;
