import { z } from "zod";
import { regionSchema } from "./analysis.js";
import { bboxSchema } from "./geo.js";
import { citySchema } from "./place.js";
import { AMENITY_IDS, PROPERTY_TYPES } from "./constants.js";

export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export const amenityIdSchema = z.enum(AMENITY_IDS);

/**
 * Listing source: a portal with its own extension ("quintoandar", "chavesnamao"…) or the website of a real estate
 * agency found in the city ("site:gallinari.com.br"), read by the generic extension.
 */
export const sourceIdSchema = z.string().min(1).max(120);
export type SourceId = z.infer<typeof sourceIdSchema>;
/** "other" = a pasted link from a site without its own scraper. */
export type ListingSource = SourceId | "other";

/**
 * ok = readable; robots = the site asks robots not to read it (we comply); blocked = the site blocks automated
 * reads; no-data = the page has no listings in a readable format (needs a dedicated extension); error = site down.
 */
export const SOURCE_STATUSES = ["ok", "robots", "blocked", "no-data", "error"] as const;
export const sourceStatusSchema = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

/** A source that can (or cannot) be read in the chosen city. */
export const sourceInfoSchema = z.object({
  id: sourceIdSchema,
  label: z.string(),
  /** portal = site that aggregates many agencies; agency = the agency's own website. */
  kind: z.enum(["portal", "agency"]),
  site: z.string(),
  status: sourceStatusSchema,
  /** Website platform, when recognized ("Kenlo", "Imoview", "Sites do Mercado"…). */
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
  /** "<source>:<id at the source>" */
  id: z.string(),
  source: z.string(),
  /** Source name to display ("Chaves na Mão", "Imobiliária Gallinari"). */
  sourceLabel: z.string().optional(),
  /** Agency that advertises the listing, when the portal says. */
  agency: z.string().optional(),
  url: z.string(),
  title: z.string(),
  type: propertyTypeSchema,
  typeLabel: z.string(),
  rent: z.number(),
  /** Rent + condo fee + property tax (when known). */
  total: z.number(),
  condo: z.number().optional(),
  /** IPTU, the Brazilian property tax (monthly). */
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
  /** Amenities detected in the listing text. */
  amenities: z.array(amenityIdSchema).optional(),
});
export type Listing = z.infer<typeof listingSchema>;

/** What the user is looking for. Sent to sites that accept filters and applied again on the server. */
export const listingFiltersSchema = z.object({
  types: z.array(propertyTypeSchema),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  /** Price compared: total (rent + condo fee + tax) or rent only. */
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

// ---------- Pasted links ----------

export const linksRequestSchema = z.object({
  urls: z.array(z.string().min(8).max(2048)).min(1).max(60),
  cityBBox: bboxSchema.optional(),
});
export type LinksRequest = z.infer<typeof linksRequestSchema>;

export const linkResultSchema = z.object({
  /** Position in the pasted list (the number on the map marker). */
  index: z.number(),
  url: z.string(),
  listing: listingSchema.optional(),
  error: z.string().optional(),
});
export type LinkResult = z.infer<typeof linkResultSchema>;
