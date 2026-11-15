import { MapContainer, TileLayer } from "react-leaflet";
import type {
  AnalysisResult,
  BBox,
  BusLine,
  City,
  FeatureDef,
  LatLng,
  Listing,
  RegionLevel,
} from "@homematch/contracts";
import { Boundary } from "../layers/Boundary";
import { BusLines } from "../layers/BusLines";
import { atLeast } from "@homematch/domain";
import { Cells } from "../layers/Cells";
import { FitBounds, MapEvents, ZoomTopRight } from "../layers/Controls";
import { ListingMarkers } from "../layers/ListingMarkers";
import { Pois } from "../layers/Pois";
import { RegionBadges } from "../layers/RegionBadges";
import { Routes } from "../layers/Routes";
import { WorkMarker } from "../layers/WorkMarker";
import type { MapSettings } from "../model/settings";
import type { FitTarget, LineHover, NumberedListing } from "../types";

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
  /** Nível mínimo das regiões mostradas. */
  minLevel: RegionLevel;
  fit: FitTarget;
  onBoundsChange?: (b: BBox) => void;
  /** Imóvel selecionado (pin escuro + prévia). */
  selectedId: string | null;
  /** Clique num pin: seleciona o imóvel. */
  onSelectListing: (l: Listing) => void;
  onLineHover?: LineHover;
}

/**
 * O mapa: tiles do OSM e as camadas (cada uma em `layers/`, desenhada de forma imperativa em canvas por
 * desempenho). Quais aparecem vem das configurações do mapa.
 */
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
      <Cells analysis={p.analysis} features={p.features} minLevel={p.minLevel} visible={p.settings.cells} />
      <Routes
        analysis={p.analysis}
        hidden={p.settings.hiddenLines}
        onHover={p.onLineHover}
        visible={p.settings.routes}
      />
      <Pois analysis={p.analysis} features={p.features} hidden={p.settings.hiddenPois} visible={p.settings.pois} />
      <BusLines
        lines={p.busLines}
        stops={p.settings.stops}
        hidden={p.settings.hiddenLines}
        onHover={p.onLineHover}
        visible={p.settings.myLines}
      />
      {p.analysis && (
        <RegionBadges
          regions={p.analysis.regions.filter((r) => atLeast(r.level, p.minLevel))}
          selected={p.selectedRegions}
          onToggle={p.onToggleRegion}
          visible={p.settings.badges}
        />
      )}
      <ListingMarkers
        listings={p.listings}
        analysis={p.analysis}
        focus={p.focusListing}
        selectedId={p.selectedId}
        visible={p.settings.listings}
        onSelect={p.onSelectListing}
      />
      <ListingMarkers
        listings={p.myLinks}
        analysis={p.analysis}
        focus={p.focusListing}
        selectedId={p.selectedId}
        visible={p.settings.myLinks}
        numbered
        onSelect={p.onSelectListing}
      />
      <WorkMarker work={p.work} />
    </MapContainer>
  );
}
