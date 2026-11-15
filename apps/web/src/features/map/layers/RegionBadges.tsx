import L from "leaflet";
import { useMemo } from "react";
import type { Region } from "@homematch/contracts";
import { useLayer } from "../hooks/useLayer";
import { esc } from "../lib/leaflet";

/** Selo numerado das melhores regiões; clique inclui ou tira a região da busca de imóveis. */
export function RegionBadges({
  regions,
  selected,
  onToggle,
  visible,
}: {
  regions: Region[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  visible: boolean;
}) {
  const top = useMemo(() => regions.slice(0, 15), [regions]);
  useLayer(
    (g) => {
      for (const r of top) {
        const on = selected.has(r.id);
        const icon = L.divIcon({
          className: "",
          html: `<div class="badge-region ${on ? "on" : ""}"><span>${r.rank}</span>${esc(r.name)}</div>`,
          iconSize: undefined as unknown as L.PointExpression,
          iconAnchor: [14, 14],
        });
        L.marker([r.lat, r.lng], { icon, zIndexOffset: 500 - r.rank })
          .on("click", () => onToggle(r.id))
          .bindTooltip(
            `~${r.commuteMin} min até o trabalho · nota ${r.score.toFixed(0)}<br><small>clique para ${on ? "tirar da" : "incluir na"} busca de imóveis</small>`,
          )
          .addTo(g);
      }
    },
    [top, selected],
    visible,
  );
  return null;
}
