// Presentation used only by the UI (money and distance come from @homematch/domain).
import type { RegionLevel } from "@homematch/contracts";
import { t } from "@homematch/i18n";

/** Color of each region level (map, legend and tags). */
export const LEVEL_COLOR: Record<RegionLevel, string> = {
  excellent: "hsl(140 70% 38%)",
  good: "hsl(95 65% 45%)",
  ok: "hsl(42 85% 52%)",
};

/** Score color (0..100): yellow → green. */
export function scoreColor(score: number): string {
  const ratio = Math.max(0, Math.min(1, score / 100));
  const hue = 45 + ratio * 95;
  const light = 58 - ratio * 18;
  return `hsl(${hue.toFixed(0)} 75% ${light.toFixed(0)}%)`;
}

const SOURCE_LABEL: Record<string, string> = { quintoandar: "QuintoAndar", vivareal: "VivaReal", other: "Link" };

/** Source name to display: what the server sent, or the known name. */
export const sourceName = (l: { source: string; sourceLabel?: string }, fallback: string = t.ui.common.site) =>
  l.sourceLabel ?? SOURCE_LABEL[l.source] ?? fallback;

/** Short form of a feature name: "Mercado grande / atacarejo" → "Mercado grande" (the part before the slash). */
export const shortLabel = (label: string) => label.split(" / ")[0]!;
