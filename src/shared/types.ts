// Tipos compartilhados entre o servidor (src/server) e o mapa (src/web).

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Anel de polígono em [lng, lat] (ordem GeoJSON). Um polígono é [externo, ...buracos]. */
export type Ring = [number, number][];
export type Polygon = Ring[];

export interface PlaceResult {
  osmId: string; // ex.: "R298285" (relation), "N123" (node)
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  bbox: BBox;
  kind: string; // city, town, road, house...
  city?: string;
  state?: string;
  stateCode?: string; // "SP"
}

export interface City extends PlaceResult {
  boundary?: Polygon[]; // multipolígono do limite municipal
}

// ---------- Características (o que a pessoa quer ter perto) ----------

export interface FeatureDef {
  id: string;
  label: string;
  emoji: string;
  color: string;
  defaultRadius: number; // metros
  description: string;
}

export interface FeatureRequest {
  id: string;
  radius: number; // metros
}

export interface Poi {
  id: string;
  feature: string;
  lat: number;
  lng: number;
  name?: string;
}

// ---------- Transporte ----------

export type TransitMode = "bus" | "trolleybus" | "subway" | "train" | "light_rail" | "tram" | "monorail";

export interface TransitRoute {
  id: string; // id da relação OSM
  ref?: string;
  name: string;
  mode: TransitMode;
  color: string;
  operator?: string;
  /** Paradas em ordem, [lat, lng]. Também usado para desenhar a linha. */
  path: [number, number][];
}

// ---------- Análise ----------

export interface AnalyzeRequest {
  city: City;
  work: LatLng;
  features: FeatureRequest[];
  maxCommuteMin: number;
  maxWalkToStopM: number;
  cellSizeM: number;
  /** 0..1 — quanto o tempo de trajeto pesa na nota (o resto é proximidade das características). */
  commuteWeight: number;
}

export interface Cell {
  id: string;
  lat: number;
  lng: number;
  commuteMin: number;
  via: string; // "a pé" ou o rótulo da linha
  routeId?: string;
  featureDist: Record<string, number>; // metros até a característica mais próxima
  score: number; // 0..100
  region: string;
}

export interface Region {
  id: string;
  rank: number;
  name: string;
  lat: number;
  lng: number;
  bbox: BBox;
  commuteMin: number;
  commuteAvg: number;
  score: number;
  cellCount: number;
  via: string[];
  featureDist: Record<string, number>;
}

export interface AnalysisResult {
  work: LatLng;
  cellSizeM: number;
  routes: TransitRoute[];
  pois: Record<string, Poi[]>;
  cells: Cell[];
  regions: Region[];
  stats: {
    cellsTotal: number;
    cellsReachable: number;
    cellsMatching: number;
    stopsUsable: number;
  };
  warnings: string[];
}

// ---------- Imóveis ----------

export type PropertyType = "apartamento" | "casa" | "casa_condominio" | "studio" | "outro";

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  casa_condominio: "Casa de condomínio",
  studio: "Studio / kitnet",
  outro: "Outro",
};

export type SourceId = "quintoandar" | "vivareal";
/** "outro" = link colado de um site sem raspador próprio. */
export type ListingSource = SourceId | "outro";

export interface Listing {
  id: string; // "<fonte>:<id na fonte>"
  source: ListingSource;
  url: string;
  title: string;
  type: PropertyType;
  typeLabel: string;
  rent: number;
  total: number; // aluguel + condomínio + IPTU (quando conhecido)
  condo?: number;
  iptu?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  furnished?: boolean;
  address?: string;
  neighbourhood?: string;
  lat: number;
  lng: number;
  approxLocation: boolean;
  image?: string;
  region?: string;
}

export interface ListingsRequest {
  city: Pick<City, "name" | "stateCode" | "bbox">;
  regions: Pick<Region, "id" | "name" | "lat" | "lng" | "bbox">[];
  sources: SourceId[];
  maxPerRegion: number;
}

// ---------- Meus links ----------

export interface LinksRequest {
  urls: string[];
  cityBBox?: BBox;
}

export interface LinkResult {
  index: number; // posição na lista colada (o número do ícone no mapa)
  url: string;
  listing?: Listing;
  error?: string;
}

/** Uma linha de ônibus/metrô com o traçado exato (vias do OSM) e as paradas. */
export interface BusLine {
  id: string; // relação OSM
  ref?: string;
  name: string;
  from?: string;
  to?: string;
  mode: TransitMode;
  color: string;
  operator?: string;
  website?: string;
  segments: [number, number][][]; // [lat, lng]
  stops: { lat: number; lng: number; name?: string }[];
}

// ---------- Streaming (NDJSON) ----------

export type StreamEvent<T> =
  | { type: "progress"; message: string }
  | { type: "warning"; message: string }
  | { type: "partial"; data: T }
  | { type: "result"; data: T }
  | { type: "error"; message: string };
