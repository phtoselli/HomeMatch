import L from "leaflet";
import type { LineHover } from "../types";

/** Texto de fora (OSM, anúncios) vai para o HTML de tooltips e ícones do Leaflet: sempre escapado. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Destaca a linha sob o mouse (mais grossa e por cima das outras) e avisa quem mostra o popover. */
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
