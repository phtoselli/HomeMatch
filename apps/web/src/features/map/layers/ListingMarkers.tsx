import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import type { AnalysisResult, Listing } from "@homematch/contracts";
import { makeCellLookup, moneyShort } from "@homematch/domain";
import { useLayer } from "../hooks/useLayer";
import { esc } from "../lib/leaflet";

function priceIcon(l: Listing & { index?: number }, selected: boolean, numbered?: boolean): L.DivIcon {
  const cls = `${selected ? " on" : ""}${l.approxLocation ? " approx" : ""}`;
  return L.divIcon({
    className: "",
    html: numbered
      ? `<div class="pin-link${cls}"><b>${l.index}</b>${l.rent ? moneyShort(l.total) : ""}</div>`
      : `<div class="pin-price${cls}">${l.rent ? moneyShort(l.total) : "?"}</div>`,
    iconSize: undefined as unknown as L.PointExpression,
    iconAnchor: numbered ? [16, 15] : [30, 14],
  });
}

/** Price pins for listings (or numbered, for pasted links). */
export function ListingMarkers({
  listings,
  analysis,
  focus,
  selectedId,
  visible,
  numbered,
  onSelect,
}: {
  listings: (Listing & { index?: number })[];
  analysis: AnalysisResult | null;
  focus: string | null;
  selectedId: string | null;
  visible: boolean;
  numbered?: boolean;
  onSelect: (l: Listing) => void;
}) {
  const map = useMap();
  const markers = useRef(new Map<string, { m: L.Marker; l: Listing & { index?: number } }>());
  const lookup = useMemo(() => (analysis ? makeCellLookup(analysis.cells, analysis.cellSizeM) : null), [analysis]);
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  useLayer(
    (g) => {
      markers.current.clear();
      for (const l of listings) {
        const cell = lookup?.(l);
        const tip = `${esc(l.typeLabel)}${l.bedrooms ? ` · ${l.bedrooms} qto` : ""}${l.area ? ` · ${l.area} m²` : ""}${cell ? ` · ~${cell.commuteMin} min` : ""}`;
        const on = selRef.current === l.id;
        const m = L.marker([l.lat, l.lng], {
          icon: priceIcon(l, on, numbered),
          riseOnHover: true,
          zIndexOffset: on ? 2000 : numbered ? 800 : 200,
          title: `${l.typeLabel}, ${moneyShort(l.total)}`,
        })
          .bindTooltip(tip, { direction: "top", offset: [0, -14] })
          .on("click", () => onSelect(l))
          .addTo(g);
        markers.current.set(l.id, { m, l });
      }
    },
    [listings, lookup, onSelect],
    visible,
  );
  // Selection: only swap the icons of the two pins involved (without rebuilding the layer).
  const prev = useRef<string | null>(null);
  useEffect(() => {
    for (const id of [prev.current, selectedId]) {
      const e = id ? markers.current.get(id) : undefined;
      if (!e) continue;
      const on = id === selectedId;
      e.m.setIcon(priceIcon(e.l, on, numbered));
      e.m.setZIndexOffset(on ? 2000 : numbered ? 800 : 200);
    }
    prev.current = selectedId;
  }, [selectedId, numbered]);
  useEffect(() => {
    const e = focus ? markers.current.get(focus) : undefined;
    if (e) map.flyTo(e.m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focus, map]);
  return null;
}
