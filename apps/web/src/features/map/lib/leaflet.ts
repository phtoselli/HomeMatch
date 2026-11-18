import L from "leaflet";
import type { LineHover } from "../types";

/** Third-party text (OSM, listings) going into Leaflet tooltip/icon HTML: always escaped. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Highlights the hovered line (thicker and on top) and notifies whoever shows the popover. */
export function hoverable(pl: L.Polyline, key: string, weight: number, onHover?: LineHover) {
  pl.on("mouseover", (e: L.LeafletMouseEvent) => {
    pl.setStyle({ weight: weight + 3, opacity: 1 });
    pl.bringToFront();
    onHover?.(key, e.containerPoint);
  });
  pl.on("mouseout", () => {
    pl.setStyle({ weight, opacity: pl.options.opacity === 1 ? 0.85 : pl.options.opacity });
    onHover?.(null);
  });
  pl.on("click", (e: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(e);
    onHover?.(key, e.containerPoint, true);
  });
  return pl;
}
