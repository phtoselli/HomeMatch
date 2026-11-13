import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { AnalysisResult, BBox, BusLine, City, FeatureDef, LatLng, Listing, Region } from "../shared/types";
import { makeCellLookup, meters, moneyShort, scoreColor } from "./format";

export interface Layers {
  routes: boolean;
  pois: boolean;
  cells: boolean;
  listings: boolean;
}

export type NumberedListing = Listing & { index: number };

interface Props {
  city: City | null;
  work: LatLng | null;
  pickingWork: boolean;
  onPickWork: (p: LatLng) => void;
  analysis: AnalysisResult | null;
  features: FeatureDef[];
  selectedRegions: Set<string>;
  onToggleRegion: (id: string) => void;
  listings: Listing[];
  myLinks: NumberedListing[];
  busLines: BusLine[];
  focusListing: string | null;
  layers: Layers;
  fit: { bbox: BBox; key: number } | null;
  onBoundsChange?: (b: BBox) => void;
  /** Clique num imóvel: abre os detalhes (modal). */
  onOpenListing: (l: Listing) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const SOURCE_LABEL: Record<string, string> = { quintoandar: "QuintoAndar", vivareal: "VivaReal", outro: "Link" };

function FitBounds({ fit }: { fit: Props["fit"] }) {
  const map = useMap();
  useEffect(() => {
    if (!fit) return;
    const b = fit.bbox;
    map.flyToBounds([[b.south, b.west], [b.north, b.east]], { padding: [30, 30], duration: 0.8, maxZoom: 15 });
  }, [fit?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function MapEvents({ active, onPick, onBounds }: { active: boolean; onPick: (p: LatLng) => void; onBounds?: (b: BBox) => void }) {
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

/** Camada imperativa: recria um LayerGroup quando as dependências mudam (rápido para milhares de itens). */
function useLayer(build: (group: L.LayerGroup) => void, deps: unknown[], visible = true) {
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

function Boundary({ city }: { city: City | null }) {
  useLayer(
    (g) => {
      if (!city?.boundary) return;
      const latlngs = city.boundary.map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));
      L.polygon(latlngs, { color: "#495057", weight: 1.5, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
    },
    [city],
  );
  return null;
}

function WorkMarker({ work }: { work: LatLng | null }) {
  useLayer(
    (g) => {
      if (!work) return;
      const icon = L.divIcon({ className: "", html: '<div class="pin-work">💼</div>', iconSize: [36, 36], iconAnchor: [18, 34] });
      L.marker([work.lat, work.lng], { icon, zIndexOffset: 1000 }).bindTooltip("Trabalho").addTo(g);
    },
    [work?.lat, work?.lng],
  );
  return null;
}

function Routes({ analysis, visible }: { analysis: AnalysisResult | null; visible: boolean }) {
  useLayer(
    (g) => {
      for (const r of analysis?.routes ?? []) {
        L.polyline(r.shape ?? r.path, { color: r.color, weight: r.mode === "bus" || r.mode === "trolleybus" ? 2.5 : 4.5, opacity: 0.75 })
          .bindTooltip(`<b>${esc(r.ref ?? "")}</b> ${esc(r.name)}${r.operator ? `<br><small>${esc(r.operator)}</small>` : ""}`, { sticky: true })
          .addTo(g);
      }
    },
    [analysis],
    visible,
  );
  return null;
}

/** A partir deste zoom os lugares viram pins com ícone (🛒, 🌳…); antes, pontos coloridos. */
const PIN_ZOOM = 14;
/** Até quantos lugares dá para mostrar todos como pin sem pesar o mapa. */
const MAX_PINS = 300;

/** Pin com o ícone da característica (🛒 mercado, 🌳 parque, 🏋️ academia…) para cada lugar ativo. */
function Pois({ analysis, features, visible }: { analysis: AnalysisResult | null; features: FeatureDef[]; visible: boolean }) {
  const icons = useMemo(() => {
    const m = new Map<string, L.DivIcon>();
    for (const f of features) {
      m.set(
        f.id,
        L.divIcon({
          className: "",
          html: `<div class="pin-poi" style="--c:${f.color}"><span>${f.emoji}</span></div>`,
          iconSize: [28, 34],
          iconAnchor: [14, 33],
          tooltipAnchor: [0, -28],
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
  const total = useMemo(() => Object.values(analysis?.pois ?? {}).reduce((n, l) => n + l.length, 0), [analysis]);
  // Poucos lugares: sempre pin. Muitos: pin só de perto (e só na área visível).
  const few = total <= MAX_PINS;
  const close = few || view.zoom >= PIN_ZOOM;
  useLayer(
    (g) => {
      const renderer = L.canvas({ padding: 0.3 });
      const area = view.bounds.pad(0.3);
      for (const [fid, list] of Object.entries(analysis?.pois ?? {})) {
        const def = features.find((f) => f.id === fid);
        const icon = icons.get(fid);
        for (const p of list) {
          if (!few && close && !area.contains([p.lat, p.lng])) continue;
          const tip = `${def?.emoji ?? ""} <b>${esc(p.name ?? def?.label ?? fid)}</b>${def ? `<br><small>${esc(def.label)}</small>` : ""}`;
          (close && icon
            ? L.marker([p.lat, p.lng], { icon, riseOnHover: true, zIndexOffset: -100 })
            : L.circleMarker([p.lat, p.lng], { renderer, radius: 5, color: "#fff", weight: 1.5, fillColor: def?.color ?? "#333", fillOpacity: 0.95 })
          )
            .bindTooltip(tip, { direction: "top" })
            .addTo(g);
        }
      }
    },
    // De longe não precisa refazer a cada arrasto; de perto, refaz para a área visível.
    [analysis, icons, close, !few && close ? view.bounds.toBBoxString() : ""],
    visible,
  );
  return null;
}

function Cells({ analysis, features, visible }: { analysis: AnalysisResult | null; features: FeatureDef[]; visible: boolean }) {
  useLayer(
    (g) => {
      if (!analysis) return;
      const renderer = L.canvas({ padding: 0.3 });
      const half = analysis.cellSizeM / 2;
      for (const c of analysis.cells) {
        const dLat = half / 111_320;
        const dLng = half / (111_320 * Math.cos((c.lat * Math.PI) / 180));
        const feats = Object.entries(c.featureDist)
          .map(([k, d]) => {
            const f = features.find((x) => x.id === k);
            return `${f?.emoji ?? ""} ${esc(f?.label ?? k)}: ${meters(d)}`;
          })
          .join("<br>");
        L.rectangle(
          [[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]],
          { renderer, stroke: false, fillColor: scoreColor(c.score), fillOpacity: 0.45 },
        )
          .bindTooltip(
            `<b>${esc(c.region)}</b> · nota ${c.score.toFixed(0)}<br>🚌 ~${c.commuteMin} min (${esc(c.via)})${feats ? `<br>${feats}` : ""}`,
            { sticky: true },
          )
          .addTo(g);
      }
    },
    [analysis, features],
    visible,
  );
  return null;
}

function RegionBadges({ regions, selected, onToggle }: { regions: Region[]; selected: Set<string>; onToggle: (id: string) => void }) {
  const top = useMemo(() => regions.slice(0, 15), [regions]);
  useLayer(
    (g) => {
      for (const r of top) {
        const on = selected.has(r.id);
        const icon = L.divIcon({
          className: "",
          html: `<div class="badge-region ${on ? "on" : ""}"><span>${r.rank}</span>${esc(r.name)}</div>`,
          iconSize: undefined as unknown as L.PointExpression,
          iconAnchor: [14, 14],
        });
        L.marker([r.lat, r.lng], { icon, zIndexOffset: 500 - r.rank })
          .on("click", () => onToggle(r.id))
          .bindTooltip(`~${r.commuteMin} min · nota ${r.score.toFixed(0)} · clique para ${on ? "remover da" : "incluir na"} busca de imóveis`)
          .addTo(g);
      }
    },
    [top, selected],
  );
  return null;
}

/** Linhas pedidas pelo número/link: traçado exato + paradas. */
function BusLines({ lines }: { lines: BusLine[] }) {
  useLayer(
    (g) => {
      const renderer = L.canvas({ padding: 0.3 });
      for (const l of lines) {
        const tip = `<b>${esc(l.ref ?? "")}</b> ${esc(l.name)}${l.operator ? `<br><small>${esc(l.operator)}</small>` : ""}`;
        // contorno branco por baixo para a linha destacar sobre o mapa
        L.polyline(l.segments, { color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(g);
        L.polyline(l.segments, { color: l.color, weight: 4.5, opacity: 0.95 }).bindTooltip(tip, { sticky: true }).addTo(g);
        for (const s of l.stops) {
          L.circleMarker([s.lat, s.lng], { renderer, radius: 4.5, color: l.color, weight: 2, fillColor: "#fff", fillOpacity: 1 })
            .bindTooltip(`🚏 ${esc(s.name ?? "Parada")}<br><small>${esc(l.ref ?? l.name)}</small>`)
            .addTo(g);
        }
      }
    },
    [lines],
  );
  return null;
}


function ListingMarkers({
  listings,
  analysis,
  focus,
  visible,
  numbered,
  onOpen,
}: {
  listings: (Listing & { index?: number })[];
  analysis: AnalysisResult | null;
  focus: string | null;
  visible: boolean;
  numbered?: boolean;
  onOpen: (l: Listing) => void;
}) {
  const map = useMap();
  const markers = useRef(new Map<string, L.Marker>());
  const lookup = useMemo(() => (analysis ? makeCellLookup(analysis.cells, analysis.cellSizeM) : null), [analysis]);
  useLayer(
    (g) => {
      markers.current.clear();
      for (const l of listings) {
        const icon = numbered
          ? L.divIcon({
              className: "",
              html: `<div class="pin-link${l.approxLocation ? " approx" : ""}"><b>${l.index}</b>${l.rent ? moneyShort(l.total) : ""}</div>`,
              iconSize: undefined as unknown as L.PointExpression,
              iconAnchor: [16, 36],
            })
          : L.divIcon({
              className: "",
              html: `<div class="pin-price src-${l.source}${l.approxLocation ? " approx" : ""}">${moneyShort(l.total)}</div>`,
              iconSize: undefined as unknown as L.PointExpression,
              iconAnchor: [30, 12],
            });
        const cell = lookup?.(l);
        const tip = `${esc(l.typeLabel)}${l.bedrooms ? ` · ${l.bedrooms} qto` : ""}${l.area ? ` · ${l.area} m²` : ""}${cell ? ` · 🚌 ~${cell.commuteMin} min` : ""}<br><small>clique para ver detalhes</small>`;
        const m = L.marker([l.lat, l.lng], { icon, riseOnHover: true, zIndexOffset: numbered ? 800 : 200 })
          .bindTooltip(tip, { direction: "top", offset: [0, -10] })
          .on("click", () => onOpen(l))
          .addTo(g);
        markers.current.set(l.id, m);
      }
    },
    [listings, lookup, onOpen],
    visible,
  );
  useEffect(() => {
    const m = focus ? markers.current.get(focus) : undefined;
    if (m) map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

function ZoomBottomRight() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: "bottomright" }).addTo(map);
    return () => {
      z.remove();
    };
  }, [map]);
  return null;
}

export function MapView(p: Props) {
  return (
    <MapContainer center={[-15.8, -47.9]} zoom={4} className="map" zoomControl={false} preferCanvas>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        className="osm-tiles"
      />
      <ZoomBottomRight />
      <FitBounds fit={p.fit} />
      <MapEvents active={p.pickingWork} onPick={p.onPickWork} onBounds={p.onBoundsChange} />
      <Boundary city={p.city} />
      <Cells analysis={p.analysis} features={p.features} visible={p.layers.cells} />
      <Routes analysis={p.analysis} visible={p.layers.routes} />
      <Pois analysis={p.analysis} features={p.features} visible={p.layers.pois} />
      <BusLines lines={p.busLines} />
      {p.analysis && <RegionBadges regions={p.analysis.regions} selected={p.selectedRegions} onToggle={p.onToggleRegion} />}
      <ListingMarkers listings={p.listings} analysis={p.analysis} focus={p.focusListing} visible={p.layers.listings} onOpen={p.onOpenListing} />
      <ListingMarkers listings={p.myLinks} analysis={p.analysis} focus={p.focusListing} visible numbered onOpen={p.onOpenListing} />
      <WorkMarker work={p.work} />
    </MapContainer>
  );
}
