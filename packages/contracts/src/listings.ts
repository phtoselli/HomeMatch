import { z } from "zod";
import { regionSchema } from "./analysis.js";
import { bboxSchema } from "./geo.js";
import { citySchema } from "./place.js";
import { PROPERTY_TYPES } from "./constants.js";

export const propertyTypeSchema = z.enum(PROPERTY_TYPES);

/**
 * Fonte de anúncios: um portal com extensão própria ("quintoandar", "chavesnamao"…) ou o site de uma
 * imobiliária achada na cidade ("site:gallinari.com.br"), lido pela extensão genérica.
 */
export const sourceIdSchema = z.string().min(1).max(120);
export type SourceId = z.infer<typeof sourceIdSchema>;
/** "outro" = link colado de um site sem raspador próprio. */
export type ListingSource = SourceId | "outro";

/**
 * ok = lemos; robots = o site pede para robôs não lerem (respeitamos); bloqueado = o site barra leitura automática;
 * sem-dados = a página não traz os anúncios num formato que dê para ler (falta uma extensão própria); erro = fora do ar.
 */
export const sourceStatusSchema = z.enum(["ok", "robots", "bloqueado", "sem-dados", "erro"]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

/** Uma fonte que dá (ou não) para ler na cidade escolhida. */
export const sourceInfoSchema = z.object({
  id: sourceIdSchema,
  label: z.string(),
  /** portal = site que junta anúncios de muitas imobiliárias; imobiliaria = site da própria imobiliária. */
  kind: z.enum(["portal", "imobiliaria"]),
  site: z.string(),
  status: sourceStatusSchema,
  /** Plataforma do site, quando reconhecida ("Kenlo", "Imoview", "Sites do Mercado"…). */
  platform: z.string().optional(),
  note: z.string().optional(),
});
export type SourceInfo = z.infer<typeof sourceInfoSchema>;

export const sourcesResultSchema = z.object({
  city: z.string(),
  portals: z.array(sourceInfoSchema),
  agencies: z.array(sourceInfoSchema),
});
export type SourcesResult = z.infer<typeof sourcesResultSchema>;

export const listingSchema = z.object({
  /** "<fonte>:<id na fonte>" */
  id: z.string(),
  source: z.string(),
  /** Nome da fonte para mostrar ("Chaves na Mão", "Imobiliária Gallinari"). */
  sourceLabel: z.string().optional(),
  /** Imobiliária que anuncia, quando o portal informa. */
  agency: z.string().optional(),
  url: z.string(),
  title: z.string(),
  type: propertyTypeSchema,
  typeLabel: z.string(),
  rent: z.number(),
  /** Aluguel + condomínio + IPTU (quando conhecido). */
  total: z.number(),
  condo: z.number().optional(),
  iptu: z.number().optional(),
  area: z.number().optional(),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  parking: z.number().optional(),
  furnished: z.boolean().optional(),
  address: z.string().optional(),
  neighbourhood: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  approxLocation: z.boolean(),
  image: z.string().optional(),
  region: z.string().optional(),
  /** Comodidades detectadas no texto do anúncio: "armario_cozinha", "armario_quarto", "pia", "mobiliado". */
  amenities: z.array(z.string()).optional(),
});
export type Listing = z.infer<typeof listingSchema>;

/** O imóvel que a pessoa procura. Vai para os sites que aceitam filtro e é reaplicado no servidor. */
export const listingFiltersSchema = z.object({
  types: z.array(propertyTypeSchema),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  /** Preço comparado: total (aluguel + condomínio + IPTU) ou só o aluguel. */
  basis: z.enum(["total", "rent"]),
  minBedrooms: z.number().min(0),
  minBathrooms: z.number().min(0).optional(),
  minParking: z.number().min(0).optional(),
  minArea: z.number().min(0).optional(),
});
export type ListingFilters = z.infer<typeof listingFiltersSchema>;

export const listingsRequestSchema = z.object({
  city: citySchema.pick({ name: true, stateCode: true, bbox: true }),
  regions: z
    .array(regionSchema.pick({ id: true, name: true, lat: true, lng: true, bbox: true }))
    .min(1)
    .max(15),
  sources: z.array(sourceIdSchema).min(1).max(40),
  maxPerRegion: z.number().min(10).max(300),
  filters: listingFiltersSchema.optional(),
});
export type ListingsRequest = z.infer<typeof listingsRequestSchema>;

// ---------- Meus links ----------

export const linksRequestSchema = z.object({
  urls: z.array(z.string().min(8).max(2048)).min(1).max(60),
  cityBBox: bboxSchema.optional(),
});
export type LinksRequest = z.infer<typeof linksRequestSchema>;

export const linkResultSchema = z.object({
  /** Posição na lista colada (o número do ícone no mapa). */
  index: z.number(),
  url: z.string(),
  listing: listingSchema.optional(),
  error: z.string().optional(),
});
export type LinkResult = z.infer<typeof linkResultSchema>;
