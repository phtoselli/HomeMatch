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
  /** Paradas em ordem, [lat, lng]. Usado no cálculo e, sem `shape`, para desenhar a linha. */
  path: [number, number][];
  /** Traçado pelas ruas (quando a fonte tem), só para desenhar. */
  shape?: [number, number][][];
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
  /**
   * Busca flexível: mantém também as áreas que passam um pouco do tempo (até +15 min) ou têm o lugar pedido
   * um pouco mais longe (até 2× o raio), com nota menor e `misses` dizendo quantas coisas faltam.
   */
  flex?: boolean;
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
  /** Busca flexível: quantas coisas a área não cumpre (tempo acima do pedido, lugar além do raio). 0 = tudo. */
  misses?: number;
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
  /** Busca flexível: menor número de coisas que faltam entre as áreas da região (0 = alguma atende tudo). */
  misses?: number;
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
    /** Busca flexível: áreas que ficaram de fora por pouco (entram como "quase lá"). */
    cellsNear?: number;
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

/**
 * Fonte de anúncios: um portal com extensão própria ("quintoandar", "chavesnamao"…) ou o site de uma
 * imobiliária achada na cidade ("site:gallinari.com.br"), lido pela extensão genérica.
 */
export type SourceId = string;
/** "outro" = link colado de um site sem raspador próprio. */
export type ListingSource = SourceId | "outro";

/** Uma fonte que dá (ou não) para ler na cidade escolhida. */
export interface SourceInfo {
  id: SourceId;
  label: string;
  /** portal = site que junta anúncios de muitas imobiliárias; imobiliaria = site da própria imobiliária. */
  kind: "portal" | "imobiliaria";
  site: string;
  /**
   * ok = lemos; robots = o site pede para robôs não lerem (respeitamos); bloqueado = o site barra leitura automática;
   * sem-dados = a página não traz os anúncios num formato que dê para ler (falta uma extensão própria); erro = fora do ar.
   */
  status: "ok" | "robots" | "bloqueado" | "sem-dados" | "erro";
  /** Plataforma do site, quando reconhecida ("Kenlo", "Imoview", "Sites do Mercado"…). */
  platform?: string;
  note?: string;
}

export interface SourcesResult {
  city: string;
  portals: SourceInfo[];
  agencies: SourceInfo[];
}

export interface Listing {
  id: string; // "<fonte>:<id na fonte>"
  source: ListingSource;
  /** Nome da fonte para mostrar ("Chaves na Mão", "Imobiliária Gallinari"). */
  sourceLabel?: string;
  /** Imobiliária que anuncia, quando o portal informa. */
  agency?: string;
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
  /** Comodidades detectadas no texto do anúncio: "armario_cozinha", "armario_quarto", "pia", "mobiliado". */
  amenities?: string[];
}

/** O imóvel que a pessoa procura. Vai para os sites que aceitam filtro e é reaplicado no servidor. */
export interface ListingFilters {
  types: PropertyType[];
  priceMin: number | null;
  priceMax: number | null;
  /** Preço comparado: total (aluguel + condomínio + IPTU) ou só o aluguel. */
  basis: "total" | "rent";
  minBedrooms: number;
  minBathrooms?: number;
  minParking?: number;
  minArea?: number;
}

export interface ListingsRequest {
  city: Pick<City, "name" | "stateCode" | "bbox">;
  regions: Pick<Region, "id" | "name" | "lat" | "lng" | "bbox">[];
  sources: SourceId[];
  maxPerRegion: number;
  filters?: ListingFilters;
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

/** Uma linha de ônibus/metrô (um sentido) com o traçado exato e as paradas. */
export interface BusLine {
  id: string; // relação OSM ("123456") ou "<operador>:<linha>:<sentido>" (ex.: "emdec:353:1")
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
  /** De onde veio: "osm" ou o id do operador (ex.: "emdec"). */
  source?: string;
  /** Sentido da linha no site do operador (1 ou 2). */
  direction?: number;
  /** Distância da parada mais próxima do trabalho (busca "linhas perto do trabalho"). */
  nearWorkM?: number;
}

/** Empresa/órgão que publica as linhas de ônibus de uma cidade. */
export interface TransitOperatorInfo {
  id: string;
  name: string;
  site: string;
  /** O que o HomeMatch lê de lá. */
  provides: string;
}

// ---------- Streaming (NDJSON) ----------

export type StreamEvent<T> =
  | { type: "progress"; message: string }
  | { type: "warning"; message: string }
  | { type: "partial"; data: T }
  | { type: "result"; data: T }
  | { type: "error"; message: string };
