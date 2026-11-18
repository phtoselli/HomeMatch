import L from "leaflet";
import type { AnalysisResult } from "@homematch/contracts";
import { lineKey } from "@homematch/domain";
import { useLayer } from "../hooks/useLayer";
import { hoverable } from "../lib/leaflet";
import type { LineHover } from "../types";

/** Lines the analysis used to reach work. */
export function Routes({
  analysis,
  hidden,
  onHover,
  visible,
}: {
  analysis: AnalysisResult | null;
  hidden: string[];
  onHover?: LineHover;
  visible: boolean;
}) {
  useLayer(
    (g) => {
      // Larger tolerance: thin overlapping lines become easy to hover.
      const renderer = L.canvas({ padding: 0.3, tolerance: 6 });
      for (const r of analysis?.routes ?? []) {
        if (hidden.includes(lineKey(r))) continue;
        // Estimated leg (intercity without a mapped line): a thick dotted line, so it looks neither like a real route
        // nor like the base map's railways (dashed gray).
        const weight = r.estimated ? 5 : r.mode === "bus" || r.mode === "trolleybus" ? 2.5 : 4.5;
        const dots: L.PolylineOptions = r.estimated ? { dashArray: "0.1 10", lineCap: "round", opacity: 0.9 } : {};
        hoverable(
          L.polyline(r.shape ?? r.path, { renderer, color: r.color, weight, opacity: 0.75, ...dots }),
          lineKey(r),
          weight,
          onHover,
        ).addTo(g);
      }
    },
    [analysis, hidden],
    visible,
  );
  return null;
}
