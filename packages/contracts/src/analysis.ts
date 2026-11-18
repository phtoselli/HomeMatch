import { z } from "zod";
import { featureRequestSchema, poiSchema } from "./features.js";
import { bboxSchema, latLngSchema, latLngTupleSchema } from "./geo.js";
import { citySchema } from "./place.js";
import { transitRouteSchema } from "./transit.js";
import { REGION_LEVELS, TRAVEL_KINDS } from "./constants.js";

export const analyzeRequestSchema = z.object({
  city: citySchema,
  work: latLngSchema,
  features: z.array(featureRequestSchema).max(20),
  /**
   * Importance of public transit to work: 3 = main, 2 = important, 1 = nice to have, 0 = ignored (has a car).
   * There is no maximum commute: each region's time is computed, shown and counted towards its level.
   */
  transitWeight: z.number().int().min(0).max(3).default(3),
  /** Stops of the lines the user picked: near them, transit counts as met. [lat, lng] */
  preferredStops: z.array(latLngTupleSchema).max(5000).optional(),
  maxWalkToStopM: z.number().min(100).max(2000),
  cellSizeM: z.number().min(200).max(2000),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
/** What the app sends (fields with defaults may be omitted). */
export type AnalyzeInput = z.input<typeof analyzeRequestSchema>;

export const regionLevelSchema = z.enum(REGION_LEVELS);
export const travelKindSchema = z.enum(TRAVEL_KINDS);

export const cellSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  commuteMin: z.number(),
  /** How the commute is made: on foot, on a mapped line or on an estimated bus. */
  travel: travelKindSchema,
  /** Display label of the route ("on foot" or the line names). */
  via: z.string(),
  routeId: z.string().optional(),
  /** Meters to the closest place of each requested feature. */
  featureDist: z.record(z.string(), z.number()),
  /** 0..100: sum of the weights met (sorts cells within the same level). */
  score: z.number(),
  region: z.string(),
  /** excellent (the main criterion and almost everything), good (the main one) or ok (something, not the main). */
  level: regionLevelSchema,
  /** Criteria met ("transit" and feature ids). */
  hits: z.array(z.string()),
});
export type Cell = z.infer<typeof cellSchema>;

export const regionSchema = z.object({
  id: z.string(),
  rank: z.number(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  bbox: bboxSchema,
  commuteMin: z.number(),
  commuteAvg: z.number(),
  /** How the best cell of the region reaches work. */
  travel: travelKindSchema,
  score: z.number(),
  cellCount: z.number(),
  via: z.array(z.string()),
  featureDist: z.record(z.string(), z.number()),
  /** Best level among the region's cells. */
  level: regionLevelSchema,
  /** Criteria met by the region's best cell. */
  hits: z.array(z.string()),
});
export type Region = z.infer<typeof regionSchema>;

export const analysisResultSchema = z.object({
  work: latLngSchema,
  cellSizeM: z.number(),
  routes: z.array(transitRouteSchema),
  pois: z.record(z.string(), z.array(poiSchema)),
  cells: z.array(cellSchema),
  regions: z.array(regionSchema),
  stats: z.object({
    cellsTotal: z.number(),
    /** Cells per level. */
    levels: z.object({ excellent: z.number(), good: z.number(), ok: z.number() }),
    /** Best commute in the city and the commute that still counts as "transit met". */
    commuteBestMin: z.number(),
    commuteRefMin: z.number(),
    stopsUsable: z.number(),
  }),
  warnings: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
