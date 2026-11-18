import L from "leaflet";
import { useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { BBox, LatLng } from "@homematch/contracts";
import type { FitTarget } from "../types";

/** Invisible controls: fitting, click to mark work and zoom buttons. */

export function FitBounds({ fit }: { fit: FitTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!fit) return;
    const b = fit.bbox;
    map.flyToBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [30, 30], duration: 0.8, maxZoom: 15 },
    );
  }, [fit?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function MapEvents({
  active,
  onPick,
  onBounds,
}: {
  active: boolean;
  onPick: (p: LatLng) => void;
  onBounds?: (b: BBox) => void;
}) {
  const map = useMapEvents({
    click(e) {
      if (active) onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    moveend() {
      const b = map.getBounds();
      onBounds?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    },
  });
  useEffect(() => {
    map.getContainer().style.cursor = active ? "crosshair" : "";
  }, [active, map]);
  return null;
}

export function ZoomTopRight() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: "topright", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(map);
    return () => {
      z.remove();
    };
  }, [map]);
  return null;
}
