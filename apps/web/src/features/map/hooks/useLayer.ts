import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/** Camada imperativa: recria um LayerGroup quando as dependências mudam (rápido para milhares de itens). */
export function useLayer(build: (group: L.LayerGroup) => void, deps: unknown[], visible = true) {
  const map = useMap();
  useEffect(() => {
    if (!visible) return;
    const g = L.layerGroup();
    build(g);
    g.addTo(map);
    return () => {
      g.remove();
    };
  }, [map, visible, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
