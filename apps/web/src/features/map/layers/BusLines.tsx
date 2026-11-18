import L from "leaflet";
import type { BusLine } from "@homematch/contracts";
import { lineKey } from "@homematch/domain";
import { useLayer } from "../hooks/useLayer";
import { esc, hoverable } from "../lib/leaflet";
import type { LineHover } from "../types";

/** Lines requested by number/link: exact geometry + stops. */
export function BusLines({
  lines,
  stops,
  hidden,
  onHover,
  visible,
}: {
  lines: BusLine[];
  stops: boolean;
  hidden: string[];
  onHover?: LineHover;
  visible: boolean;
}) {
  useLayer(
    (g) => {
      const renderer = L.canvas({ padding: 0.3, tolerance: 6 });
      for (const l of lines) {
        if (hidden.includes(lineKey(l))) continue;
        // white casing underneath so the line stands out on the map
        L.polyline(l.segments, { renderer, color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(g);
        hoverable(
          L.polyline(l.segments, { renderer, color: l.color, weight: 4.5, opacity: 0.95 }),
          lineKey(l),
          4.5,
          onHover,
        ).addTo(g);
        for (const s of stops ? l.stops : []) {
          L.circleMarker([s.lat, s.lng], {
            renderer,
            radius: 4.5,
            color: l.color,
            weight: 2,
            fillColor: "#fff",
            fillOpacity: 1,
          })
            .bindTooltip(`Ponto: ${esc(s.name ?? "sem nome")}<br><small>Linha ${esc(l.ref ?? l.name)}</small>`)
            .addTo(g);
        }
      }
    },
    [lines, stops, hidden],
    visible,
  );
  return null;
}
