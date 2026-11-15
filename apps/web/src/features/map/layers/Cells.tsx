import L from "leaflet";
import type { AnalysisResult, FeatureDef, RegionLevel } from "@homematch/contracts";
import { LEVEL_LABEL, TRANSIT_CRITERION, atLeast, meters, noTransitNear } from "@homematch/domain";
import { LEVEL_COLOR } from "@/shared/lib/format";
import { useLayer } from "../hooks/useLayer";
import { esc } from "../lib/leaflet";

/** Grade da análise: cada pedaço da cidade pintado pelo nível (excelente, boa, ok). */
export function Cells({
  analysis,
  features,
  minLevel,
  visible,
}: {
  analysis: AnalysisResult | null;
  features: FeatureDef[];
  minLevel: RegionLevel;
  visible: boolean;
}) {
  useLayer(
    (g) => {
      if (!analysis) return;
      const renderer = L.canvas({ padding: 0.3 });
      const half = analysis.cellSizeM / 2;
      for (const c of analysis.cells) {
        if (!atLeast(c.level, minLevel)) continue;
        const dLat = half / 111_320;
        const dLng = half / (111_320 * Math.cos((c.lat * Math.PI) / 180));
        const feats = Object.entries(c.featureDist)
          .map(([k, d]) => {
            const f = features.find((x) => x.id === k);
            return `${c.hits.includes(k) ? "✓" : "✗"} ${esc(f?.label ?? k)}: ${meters(d)}`;
          })
          .join("<br>");
        const transit = c.hits.includes(TRANSIT_CRITERION) ? "✓" : "✗";
        const trip = noTransitNear(c) ? "sem ônibus por perto" : `~${c.commuteMin} min até o trabalho (${esc(c.via)})`;
        L.rectangle(
          [
            [c.lat - dLat, c.lng - dLng],
            [c.lat + dLat, c.lng + dLng],
          ],
          { renderer, stroke: false, fillColor: LEVEL_COLOR[c.level], fillOpacity: 0.3 + 0.25 * (c.score / 100) },
        )
          .bindTooltip(
            `<b>${esc(c.region)}</b> · ${LEVEL_LABEL[c.level]}<br>${transit} ${trip}${feats ? `<br>${feats}` : ""}`,
            { sticky: true },
          )
          .addTo(g);
      }
    },
    [analysis, features, minLevel],
    visible,
  );
  return null;
}
