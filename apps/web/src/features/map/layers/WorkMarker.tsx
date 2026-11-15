import L from "leaflet";
import type { LatLng } from "@homematch/contracts";
import { iconSvg } from "@/shared/ui";
import { useLayer } from "../hooks/useLayer";

/** Pin do trabalho (sempre visível). */
export function WorkMarker({ work }: { work: LatLng | null }) {
  useLayer(
    (g) => {
      if (!work) return;
      const icon = L.divIcon({
        className: "",
        html: `<div class="pin-work">${iconSvg("brief", 16)}<span>Trabalho</span></div>`,
        iconSize: undefined as unknown as L.PointExpression,
        iconAnchor: [44, 40],
      });
      L.marker([work.lat, work.lng], { icon, zIndexOffset: 1000, keyboard: false }).addTo(g);
    },
    [work?.lat, work?.lng],
  );
  return null;
}
