import type { BBox, Listing, ListingFilters, PropertyType } from "@homematch/contracts";
import { BROWSER_UA, HOUR, cached, httpJson } from "../http.js";
import { normalizeType, slugify } from "./normalize.js";
import type { SourceAdapter } from "./types.js";

// QuintoAndar: a própria página de busca chama esta API com a área visível do mapa (viewport).
const API = "https://apigw.prod.quintoandar.com.br/house-listing-search/v3/search/list";
const SITE = "https://www.quintoandar.com.br";
const PAGE_SIZE = 50;

const FIELDS = [
  "id",
  "coverImage",
  "rent",
  "totalCost",
  "iptuPlusCondominium",
  "area",
  "address",
  "regionName",
  "city",
  "type",
  "forRent",
  "bedrooms",
  "parkingSpaces",
  "bathrooms",
  "isFurnished",
  "neighbourhood",
  "location",
];

interface QaHit {
  _id: string;
  _source: {
    id: number;
    coverImage?: string;
    rent?: number;
    totalCost?: number;
    iptuPlusCondominium?: number;
    area?: number;
    address?: string;
    regionName?: string;
    city?: string;
    type?: string;
    forRent?: boolean;
    bedrooms?: number;
    parkingSpaces?: number;
    bathrooms?: number;
    isFurnished?: boolean;
    neighbourhood?: string;
    location?: { lat: number; lon: number };
  };
}

export interface QaResponse {
  hits: { total: { value: number }; hits: QaHit[] };
}

const QA_TYPE_LABEL: Record<string, string> = {
  Apartamento: "Apartamento",
  Casa: "Casa",
  CasaCondominio: "Casa de condomínio",
  StudioOuKitchenette: "Studio / kitnet",
};

/** Parse puro da resposta da API → anúncios de aluguel com coordenada. */
export function parseQuintoAndar(json: QaResponse): Listing[] {
  const out: Listing[] = [];
  for (const h of json.hits?.hits ?? []) {
    const s = h._source;
    if (!s || s.forRent === false || !s.rent || !s.location) continue;
    const typeLabel = QA_TYPE_LABEL[s.type ?? ""] ?? s.type ?? "Imóvel";
    const extras = s.iptuPlusCondominium ?? 0;
    out.push({
      id: `quintoandar:${s.id}`,
      source: "quintoandar",
      url: `${SITE}/imovel/${s.id}/alugar`,
      title: `${typeLabel}${s.area ? ` ${s.area} m²` : ""}${s.bedrooms ? `, ${s.bedrooms} quarto${s.bedrooms > 1 ? "s" : ""}` : ""}`,
      type: normalizeType(s.type ?? ""),
      typeLabel,
      rent: s.rent,
      total: s.totalCost ?? s.rent + extras,
      condo: extras || undefined, // a API devolve condomínio + IPTU somados
      area: s.area,
      bedrooms: s.bedrooms,
      bathrooms: s.bathrooms,
      parking: s.parkingSpaces,
      furnished: s.isFurnished,
      // A lista não traz descrição: só dá para saber se é mobiliado. Sem isso, "sem informação".
      amenities: s.isFurnished ? ["mobiliado"] : undefined,
      address: [s.address, s.neighbourhood ?? s.regionName].filter(Boolean).join(", "),
      neighbourhood: s.neighbourhood ?? s.regionName,
      lat: s.location.lat,
      lng: s.location.lon,
      approxLocation: false,
      image: s.coverImage ? `${SITE}/img/crop/landscape/540x360/${s.coverImage}` : undefined,
    });
  }
  return out;
}

/** Tipos que a busca do QuintoAndar aceita (casa de condomínio não tem código conhecido: filtramos depois). */
const QA_TYPE: Partial<Record<PropertyType, string>> = { apartamento: "APARTMENT", casa: "HOUSE", studio: "STUDIO" };

const range = (min?: number | null, max?: number | null) => ({
  range: { ...(min ? { min } : {}), ...(max ? { max } : {}) },
});

export function buildQaBody(bbox: BBox, citySlug: string, offset: number, f?: ListingFilters) {
  const center = { lat: (bbox.north + bbox.south) / 2, lng: (bbox.east + bbox.west) / 2 };
  // Só manda o tipo quando todos os escolhidos têm código; senão busca tudo e o servidor filtra.
  const types = f?.types.length && f.types.every((t) => QA_TYPE[t]) ? f.types.map((t) => QA_TYPE[t]!) : [];
  // O site só filtra pelo custo total; no modo "só aluguel" o servidor filtra depois.
  const priceRange =
    f && f.basis === "total" && (f.priceMin || f.priceMax)
      ? [{ costType: "TOTAL_COST", ...range(f.priceMin, f.priceMax) }]
      : [];
  return {
    slug: citySlug,
    topics: [],
    fields: FIELDS,
    sorting: { criteria: "RELEVANCE", order: "DESC" },
    pagination: { pageSize: PAGE_SIZE, offset },
    context: { listShowing: true, mapShowing: true, numPhotos: 0, isSSR: false },
    filters: {
      enableFlexibleSearch: false,
      businessContext: "RENT",
      location: {
        coordinate: center,
        viewport: { east: bbox.east, north: bbox.north, south: bbox.south, west: bbox.west },
        neighborhoods: [],
        countryCode: "BR",
      },
      priceRange,
      availability: "ANY",
      occupancy: "ANY",
      partnerIds: [],
      specialConditions: [],
      excludedSpecialConditions: [],
      blocklist: [],
      selectedHouses: [],
      categories: [],
      houseSpecs: {
        area: range(f?.minArea),
        houseTypes: types,
        amenities: [],
        installations: [],
        bathrooms: range(f?.minBathrooms),
        bedrooms: range(f?.minBedrooms),
        parkingSpace: range(f?.minParking),
        suites: { range: {} },
      },
      origin: "HYBRID",
    },
    locationDescriptions: [{ description: citySlug }],
  };
}

export const quintoAndar: SourceAdapter = {
  id: "quintoandar",
  label: "QuintoAndar",
  async search({ city, region, max, filters, log }) {
    const slug = `${slugify(city.name)}-${(city.stateCode ?? "").toLowerCase()}-brasil`;
    const out: Listing[] = [];
    for (let offset = 0; offset < max; offset += PAGE_SIZE) {
      const body = JSON.stringify(buildQaBody(region.bbox, slug, offset, filters));
      const json = await cached("quintoandar", body, 6 * HOUR, () =>
        httpJson<QaResponse>(API, {
          method: "POST",
          body,
          minIntervalMs: 1200,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": BROWSER_UA,
            Origin: SITE,
            Referer: `${SITE}/`,
          },
        }),
      );
      const page = parseQuintoAndar(json);
      out.push(...page);
      log(`QuintoAndar · ${region.name}: ${out.length} de ${json.hits?.total?.value ?? "?"} anúncios`);
      if ((json.hits?.hits?.length ?? 0) < PAGE_SIZE) break;
    }
    return out.slice(0, max);
  },
};
