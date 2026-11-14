import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { AnalysisResult, BBox, BusLine, City, FeatureDef, LatLng, Listing, Region } from "../shared/types";
import { makeCellLookup, meters, moneyShort, scoreColor } from "./format";
import { FEATURE_ICON, iconSvg } from "./icons";
import { lineKey } from "./lines";
import { greatThreshold, showCell, type MapSettings } from "./mapSettings";

/** Mouse sobre uma linha (ponto na tela do mapa); clique fixa o popover. key null = saiu da linha. */
export type LineHover = (key: string | null, at?: { x: number; y: number }, pin?: boolean) => void;

/** Destaca a linha sob o mouse (mais grossa e por cima das outras) e avisa quem mostra o popover. */
function hoverable(pl: L.Polyline, key: string, weight: number, onHover?: LineHover) {
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
  settings: MapSettings;
  fit: { bbox: BBox; key: number } | null;
  onBoundsChange?: (b: BBox) => void;
  /** Imóvel selecionado (pin escuro + prévia). */
  selectedId: string | null;
  /** Clique num pin: seleciona o imóvel. */
  onSelectListing: (l: Listing) => void;
  onLineHover?: LineHover;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const SOURCE_LABEL: Record<string, string> = { quintoandar: "QuintoAndar", vivareal: "VivaReal", outro: "Link" };

/** Nome da fonte para mostrar: o que o servidor mandou, ou o nome conhecido. */
export const sourceName = (l: { source: string; sourceLabel?: string }, fallback = "site") => l.sourceLabel ?? SOURCE_LABEL[l.source] ?? fallback;

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

function Boundary({ city, visible }: { city: City | null; visible: boolean }) {
  useLayer(
    (g) => {
      if (!city?.boundary) return;
      const latlngs = city.boundary.map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));
      L.polygon(latlngs, { color: "#495057", weight: 1.5, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
    },
    [city],
    visible,
  );
  return null;
}

function WorkMarker({ work }: { work: LatLng | null }) {
  useLayer(
    (g) => {
      if (!work) return;
      const icon = L.divIcon({ className: "", html: `<div class="pin-work">${iconSvg("brief", 16)}<span>Trabalho</span></div>`, iconSize: undefined as unknown as L.PointExpression, iconAnchor: [44, 40] });
      L.marker([work.lat, work.lng], { icon, zIndexOffset: 1000, keyboard: false }).addTo(g);
    },
    [work?.lat, work?.lng],
  );
  return null;
}

function Routes({ analysis, hidden, onHover, visible }: { analysis: AnalysisResult | null; hidden: string[]; onHover?: LineHover; visible: boolean }) {
  useLayer(
    (g) => {
      // Tolerância maior: linhas finas sobrepostas ficam fáceis de pegar com o mouse.
      const renderer = L.canvas({ padding: 0.3, tolerance: 6 });
      for (const r of analysis?.routes ?? []) {
        if (hidden.includes(lineKey(r))) continue;
        const weight = r.mode === "bus" || r.mode === "trolleybus" ? 2.5 : 4.5;
        hoverable(L.polyline(r.shape ?? r.path, { renderer, color: r.color, weight, opacity: 0.75 }), lineKey(r), weight, onHover).addTo(g);
      }
    },
    [analysis, hidden],
    visible,
  );
  return null;
}

/** A partir deste zoom os lugares viram pins com ícone (carrinho, árvore…); antes, pontos coloridos. */
const PIN_ZOOM = 14;
/** Até quantos lugares dá para mostrar todos como pin sem pesar o mapa. */
const MAX_PINS = 300;

/** Pin com o ícone da característica (mercado, parque, academia…) para cada lugar ativo. */
function Pois({ analysis, features, hidden, visible }: { analysis: AnalysisResult | null; features: FeatureDef[]; hidden: string[]; visible: boolean }) {
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
  const shown = useMemo(() => Object.entries(analysis?.pois ?? {}).filter(([fid]) => !hidden.includes(fid)), [analysis, hidden]);
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
            : L.circleMarker([p.lat, p.lng], { renderer, radius: 5, color: "#fff", weight: 1.5, fillColor: def?.color ?? "#333", fillOpacity: 0.95 })
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

function Cells({ analysis, features, band, visible }: { analysis: AnalysisResult | null; features: FeatureDef[]; band: MapSettings["cellBand"]; visible: boolean }) {
  const threshold = useMemo(() => greatThreshold(analysis?.cells ?? []), [analysis]);
  useLayer(
    (g) => {
      if (!analysis) return;
      const renderer = L.canvas({ padding: 0.3 });
      const half = analysis.cellSizeM / 2;
      for (const c of analysis.cells) {
        if (!showCell(c, band, threshold)) continue;
        const dLat = half / 111_320;
        const dLng = half / (111_320 * Math.cos((c.lat * Math.PI) / 180));
        const feats = Object.entries(c.featureDist)
          .map(([k, d]) => {
            const f = features.find((x) => x.id === k);
            return `${esc(f?.label ?? k)}: ${meters(d)}`;
          })
          .join("<br>");
        L.rectangle(
          [[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]],
          { renderer, stroke: false, fillColor: scoreColor(c.score), fillOpacity: 0.45 },
        )
          .bindTooltip(
            `<b>${esc(c.region)}</b> · nota ${c.score.toFixed(0)}<br>~${c.commuteMin} min até o trabalho (${esc(c.via)})${feats ? `<br>${feats}` : ""}`,
            { sticky: true },
          )
          .addTo(g);
      }
    },
    [analysis, features, band, threshold],
    visible,
  );
  return null;
}

function RegionBadges({ regions, selected, onToggle, visible }: { regions: Region[]; selected: Set<string>; onToggle: (id: string) => void; visible: boolean }) {
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
          .bindTooltip(`~${r.commuteMin} min até o trabalho · nota ${r.score.toFixed(0)}<br><small>clique para ${on ? "tirar da" : "incluir na"} busca de imóveis</small>`)
          .addTo(g);
      }
    },
    [top, selected],
    visible,
  );
  return null;
}

/** Linhas pedidas pelo número/link: traçado exato + paradas. */
function BusLines({ lines, stops, hidden, onHover, visible }: { lines: BusLine[]; stops: boolean; hidden: string[]; onHover?: LineHover; visible: boolean }) {
  useLayer(
    (g) => {
      const renderer = L.canvas({ padding: 0.3, tolerance: 6 });
      for (const l of lines) {
        if (hidden.includes(lineKey(l))) continue;
        // contorno branco por baixo para a linha destacar sobre o mapa
        L.polyline(l.segments, { renderer, color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(g);
        hoverable(L.polyline(l.segments, { renderer, color: l.color, weight: 4.5, opacity: 0.95 }), lineKey(l), 4.5, onHover).addTo(g);
        for (const s of stops ? l.stops : []) {
          L.circleMarker([s.lat, s.lng], { renderer, radius: 4.5, color: l.color, weight: 2, fillColor: "#fff", fillOpacity: 1 })
            .bindTooltip(`Ponto: ${esc(s.name ?? "sem nome")}<br><small>Linha ${esc(l.ref ?? l.name)}</small>`)
            .addTo(g);
        }
      }
    },
    [lines, stops, hidden],
    visible,
  );
  return null;
}


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

function ListingMarkers({
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
        const m = L.marker([l.lat, l.lng], { icon: priceIcon(l, on, numbered), riseOnHover: true, zIndexOffset: on ? 2000 : numbered ? 800 : 200, title: `${l.typeLabel}, ${moneyShort(l.total)}` })
          .bindTooltip(tip, { direction: "top", offset: [0, -14] })
          .on("click", () => onSelect(l))
          .addTo(g);
        markers.current.set(l.id, { m, l });
      }
    },
    [listings, lookup, onSelect],
    visible,
  );
  // Seleção: troca só o ícone dos dois pins envolvidos (sem refazer a camada).
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

function ZoomTopRight() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: "topright", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(map);
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
      <ZoomTopRight />
      <FitBounds fit={p.fit} />
      <MapEvents active={p.pickingWork} onPick={p.onPickWork} onBounds={p.onBoundsChange} />
      <Boundary city={p.city} visible={p.settings.boundary} />
      <Cells analysis={p.analysis} features={p.features} band={p.settings.cellBand} visible={p.settings.cells} />
      <Routes analysis={p.analysis} hidden={p.settings.hiddenLines} onHover={p.onLineHover} visible={p.settings.routes} />
      <Pois analysis={p.analysis} features={p.features} hidden={p.settings.hiddenPois} visible={p.settings.pois} />
      <BusLines lines={p.busLines} stops={p.settings.stops} hidden={p.settings.hiddenLines} onHover={p.onLineHover} visible={p.settings.myLines} />
      {p.analysis && <RegionBadges regions={p.analysis.regions} selected={p.selectedRegions} onToggle={p.onToggleRegion} visible={p.settings.badges} />}
      <ListingMarkers listings={p.listings} analysis={p.analysis} focus={p.focusListing} selectedId={p.selectedId} visible={p.settings.listings} onSelect={p.onSelectListing} />
      <ListingMarkers listings={p.myLinks} analysis={p.analysis} focus={p.focusListing} selectedId={p.selectedId} visible={p.settings.myLinks} numbered onSelect={p.onSelectListing} />
      <WorkMarker work={p.work} />
    </MapContainer>
  );
}
