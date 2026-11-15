import L from "leaflet";
import { useMemo, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { AnalysisResult, FeatureDef } from "@homematch/contracts";
import { FEATURE_ICON, iconSvg } from "@/shared/ui";
import { useLayer } from "../hooks/useLayer";
import { esc } from "../lib/leaflet";

/** A partir deste zoom os lugares viram pins com ícone (carrinho, árvore…); antes, pontos coloridos. */
const PIN_ZOOM = 14;
/** Até quantos lugares dá para mostrar todos como pin sem pesar o mapa. */
const MAX_PINS = 300;

/** Pin com o ícone da característica (mercado, parque, academia…) para cada lugar ativo. */
export function Pois({
  analysis,
  features,
  hidden,
  visible,
}: {
  analysis: AnalysisResult | null;
  features: FeatureDef[];
  hidden: string[];
  visible: boolean;
}) {
  const icons = useMemo(() => {
    const m = new Map<string, L.DivIcon>();
    for (const f of features) {
      m.set(
        f.id,
        L.divIcon({
          className: "",
          html: `<div class="pin-poi" style="--c:${f.color}">${FEATURE_ICON[f.id] ? iconSvg(FEATURE_ICON[f.id]!, 15) : `<span>${f.emoji}</span>`}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          tooltipAnchor: [0, -14],
        }),
      );
    }
    return m;
  }, [features]);
  // De longe, pontos leves em canvas; de perto, pins com ícone só para o que está na tela
  // (com mercado + farmácia + padaria numa cidade grande seriam milhares de elementos no DOM).
  const map = useMap();
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));
  useMapEvents({ moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }) });
  const shown = useMemo(
    () => Object.entries(analysis?.pois ?? {}).filter(([fid]) => !hidden.includes(fid)),
    [analysis, hidden],
  );
  const total = useMemo(() => shown.reduce((n, [, l]) => n + l.length, 0), [shown]);
  // Poucos lugares: sempre pin. Muitos: pin só de perto (e só na área visível).
  const few = total <= MAX_PINS;
  const close = few || view.zoom >= PIN_ZOOM;
  useLayer(
    (g) => {
      const renderer = L.canvas({ padding: 0.3 });
      const area = view.bounds.pad(0.3);
      for (const [fid, list] of shown) {
        const def = features.find((f) => f.id === fid);
        const icon = icons.get(fid);
        for (const p of list) {
          if (!few && close && !area.contains([p.lat, p.lng])) continue;
          const tip = `<b>${esc(p.name ?? def?.label ?? fid)}</b>${def ? `<br><small>${esc(def.label)}</small>` : ""}`;
          (close && icon
            ? L.marker([p.lat, p.lng], { icon, riseOnHover: true, zIndexOffset: -100 })
            : L.circleMarker([p.lat, p.lng], {
                renderer,
                radius: 5,
                color: "#fff",
                weight: 1.5,
                fillColor: def?.color ?? "#333",
                fillOpacity: 0.95,
              })
          )
            .bindTooltip(tip, { direction: "top" })
            .addTo(g);
        }
      }
    },
    // De longe não precisa refazer a cada arrasto; de perto, refaz para a área visível.
    [shown, icons, close, !few && close ? view.bounds.toBBoxString() : ""],
    visible,
  );
  return null;
}
