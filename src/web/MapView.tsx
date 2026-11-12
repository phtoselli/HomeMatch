import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { AnalysisResult, BBox, BusLine, City, FeatureDef, LatLng, Listing, Region } from "../shared/types";
import { PROPERTY_TYPE_LABEL } from "../shared/types";
import { makeCellLookup, meters, money, moneyShort, nearestStop, scoreColor, walkMin } from "./format";

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
        L.polyline(r.path, { color: r.color, weight: r.mode === "bus" || r.mode === "trolleybus" ? 2.5 : 4.5, opacity: 0.75 })
          .bindTooltip(`<b>${esc(r.ref ?? "")}</b> ${esc(r.name)}${r.operator ? `<br><small>${esc(r.operator)}</small>` : ""}`, { sticky: true })
          .addTo(g);
      }
    },
    [analysis],
    visible,
  );
  return null;
}

function Pois({ analysis, features, visible }: { analysis: AnalysisResult | null; features: FeatureDef[]; visible: boolean }) {
  useLayer(
    (g) => {
      const renderer = L.canvas({ padding: 0.3 });
      for (const [fid, list] of Object.entries(analysis?.pois ?? {})) {
        const def = features.find((f) => f.id === fid);
        for (const p of list) {
          L.circleMarker([p.lat, p.lng], { renderer, radius: 4, color: "#fff", weight: 1, fillColor: def?.color ?? "#333", fillOpacity: 0.95 })
            .bindTooltip(`${def?.emoji ?? ""} ${esc(p.name ?? def?.label ?? fid)}`)
            .addTo(g);
        }
      }
    },
    [analysis, features],
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

function popupHtml(l: Listing, extra: string): string {
  const specs = [
    l.area && `${l.area} m²`,
    l.bedrooms != null && `${l.bedrooms} qto${l.bedrooms === 1 ? "" : "s"}`,
    l.bathrooms != null && `${l.bathrooms} banh.`,
    l.parking != null && `${l.parking} vaga${l.parking === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
  const price = l.rent
    ? `<div class="pop-price">${money(l.total)} <small>${l.total > l.rent ? "total/mês" : "/mês"}</small></div>
       ${l.total > l.rent ? `<div class="pop-sub">Aluguel ${money(l.rent)} · cond./IPTU ${money(l.total - l.rent)}</div>` : ""}`
    : `<div class="pop-sub">Preço não encontrado na página</div>`;
  return `<div class="pop">
    ${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
    <div class="pop-body">
      <div class="pop-src">${SOURCE_LABEL[l.source] ?? l.source} · ${esc(PROPERTY_TYPE_LABEL[l.type])}</div>
      ${price}
      ${specs ? `<div class="pop-specs">${specs}</div>` : ""}
      <div class="pop-addr">${esc(l.address ?? l.title)}${l.approxLocation ? " <em>(posição aproximada pelo endereço)</em>" : ""}</div>
      ${extra}
      <a href="${esc(l.url)}" target="_blank" rel="noopener">Ver anúncio ↗</a>
    </div></div>`;
}

function ListingMarkers({
  listings,
  analysis,
  busLines,
  focus,
  visible,
  numbered,
}: {
  listings: (Listing & { index?: number })[];
  analysis: AnalysisResult | null;
  busLines: BusLine[];
  focus: string | null;
  visible: boolean;
  numbered?: boolean;
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
        let extra = cell ? `<div class="pop-commute">🚌 ~${cell.commuteMin} min até o trabalho · ${esc(cell.via)}</div>` : "";
        for (const line of busLines) {
          const ns = nearestStop(line, l);
          if (ns) extra += `<div class="pop-commute">🚏 ${esc(line.ref ?? line.name)}: parada a ${meters(ns.dist)} (~${walkMin(ns.dist)} min a pé)</div>`;
        }
        const m = L.marker([l.lat, l.lng], { icon, riseOnHover: true, zIndexOffset: numbered ? 800 : 0 })
          .bindPopup(popupHtml(l, extra), { maxWidth: 280, minWidth: 260 })
          .addTo(g);
        markers.current.set(l.id, m);
      }
    },
    [listings, lookup, busLines],
    visible,
  );
  useEffect(() => {
    const m = focus ? markers.current.get(focus) : undefined;
    if (m) {
      map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
      setTimeout(() => m.openPopup(), 650);
    }
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
      <ListingMarkers listings={p.listings} analysis={p.analysis} busLines={p.busLines} focus={p.focusListing} visible={p.layers.listings} />
      <ListingMarkers listings={p.myLinks} analysis={p.analysis} busLines={p.busLines} focus={p.focusListing} visible numbered />
      <WorkMarker work={p.work} />
    </MapContainer>
  );
}
