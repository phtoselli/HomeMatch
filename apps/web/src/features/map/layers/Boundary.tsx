import L from "leaflet";
import type { City } from "@homematch/contracts";
import { useLayer } from "../hooks/useLayer";

/** Contorno da cidade, tracejado. */
export function Boundary({ city, visible }: { city: City | null; visible: boolean }) {
  useLayer(
    (g) => {
      if (!city?.boundary) return;
      const latlngs = city.boundary.map((poly) =>
        poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])),
      );
      L.polygon(latlngs, { color: "#495057", weight: 1.5, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
    },
    [city],
    visible,
  );
  return null;
}
