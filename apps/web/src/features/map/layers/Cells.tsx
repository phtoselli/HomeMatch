import L from "leaflet";
import { useMemo } from "react";
import type { AnalysisResult, FeatureDef } from "@homematch/contracts";
import { greatThreshold, meters, showCell } from "@homematch/domain";
import { scoreColor } from "@/shared/lib/format";
import { useLayer } from "../hooks/useLayer";
import { esc } from "../lib/leaflet";
import type { MapSettings } from "../model/settings";

/** Grade da análise: cada pedaço da cidade pintado pela nota. */
export function Cells({
  analysis,
  features,
  band,
  visible,
}: {
  analysis: AnalysisResult | null;
  features: FeatureDef[];
  band: MapSettings["cellBand"];
  visible: boolean;
}) {
  const threshold = useMemo(() => greatThreshold(analysis?.cells ?? []), [analysis]);
  useLayer(
    (g) => {
      if (!analysis) return;
      const renderer = L.canvas({ padding: 0.3 });
      const half = analysis.cellSizeM / 2;
      for (const c of analysis.cells) {
        if (!showCell(c, band, threshold)) continue;
        const dLat = half / 111_320;
        const dLng = half / (111_320 * Math.cos((c.lat * Math.PI) / 180));
        const feats = Object.entries(c.featureDist)
          .map(([k, d]) => {
            const f = features.find((x) => x.id === k);
            return `${esc(f?.label ?? k)}: ${meters(d)}`;
          })
          .join("<br>");
        L.rectangle(
          [
            [c.lat - dLat, c.lng - dLng],
            [c.lat + dLat, c.lng + dLng],
          ],
          { renderer, stroke: false, fillColor: scoreColor(c.score), fillOpacity: 0.45 },
        )
          .bindTooltip(
            `<b>${esc(c.region)}</b> · nota ${c.score.toFixed(0)}<br>~${c.commuteMin} min até o trabalho (${esc(c.via)})${feats ? `<br>${feats}` : ""}`,
            { sticky: true },
          )
          .addTo(g);
      }
    },
    [analysis, features, band, threshold],
    visible,
  );
  return null;
}
