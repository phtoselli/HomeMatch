import L from "leaflet";
import type { AnalysisResult, Cell, FeatureDef, RegionLevel } from "@homematch/contracts";
import {
  TRANSIT_CRITERION,
  atLeast,
  levelAreas,
  levelLabel,
  makeCellLookup,
  meters,
  noTransitNear,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { AREA_STYLE, LEVEL_COLOR } from "@/shared/lib/format";
import { useLayer } from "../hooks/useLayer";
import { esc } from "../lib/leaflet";

function cellTooltip(c: Cell, features: FeatureDef[]): string {
  const feats = Object.entries(c.featureDist)
    .map(([k, d]) => {
      const f = features.find((x) => x.id === k);
      return `${c.hits.includes(k) ? "✓" : "✗"} ${esc(f?.label ?? k)}: ${meters(d)}`;
    })
    .join("<br>");
  const transit = c.hits.includes(TRANSIT_CRITERION) ? "✓" : "✗";
  const trip = noTransitNear(c) ? t.ui.results.noBusNearby : t.ui.map.cellCommute(c.commuteMin, esc(c.via));
  return `<b>${esc(c.region)}</b> · ${levelLabel(c.level)}<br>${transit} ${trip}${feats ? `<br>${feats}` : ""}`;
}

/** Analysis result on the map: smooth areas per level (excellent, good, ok), with the details of the spot on hover. */
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
      const shown = analysis.cells.filter((c) => atLeast(c.level, minLevel));
      const lookup = makeCellLookup(shown, analysis.cellSizeM, analysis.cellSizeM * 0.75);
      for (const area of levelAreas(shown, analysis.cellSizeM, minLevel)) {
        const style = AREA_STYLE[area.level];
        const color = LEVEL_COLOR[area.level];
        const shape = L.polygon(
          area.polygons.map((poly) => poly.map((ring) => ring.map((p) => [p.lat, p.lng] as [number, number]))),
          {
            renderer,
            color,
            weight: style.weight,
            opacity: 0.85,
            dashArray: style.dash,
            fillColor: color,
            fillOpacity: style.fill,
            lineJoin: "round",
          },
        );
        // One tooltip per level, filled with the spot under the pointer (the top level gets the events).
        shape.bindTooltip("", { sticky: true });
        shape.on("mousemove", (e: L.LeafletMouseEvent) => {
          const c = lookup(e.latlng);
          if (!c) return void shape.closeTooltip();
          shape.setTooltipContent(cellTooltip(c, features));
          if (!shape.isTooltipOpen()) shape.openTooltip(e.latlng);
        });
        shape.addTo(g);
      }
    },
    [analysis, features, minLevel],
    visible,
  );
  return null;
}
