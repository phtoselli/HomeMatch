import L from "leaflet";
import type { City } from "@homematch/contracts";
import { useLayer } from "../hooks/useLayer";

/** City outline, dashed. */
export function Boundary({ city, visible }: { city: City | null; visible: boolean }) {
  useLayer(
    (g) => {
      if (!city?.boundary) return;
      const latlngs = city.boundary.map((poly) =>
        poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])),
      );
      L.polygon(latlngs, {
        color: "#5b6763",
        weight: 1.2,
        opacity: 0.7,
        dashArray: "5 6",
        fill: false,
        interactive: false,
      }).addTo(g);
    },
    [city],
    visible,
  );
  return null;
}
