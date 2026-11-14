import { z } from "zod";
import { featureRequestSchema, poiSchema } from "./features.js";
import { bboxSchema, latLngSchema } from "./geo.js";
import { citySchema } from "./place.js";
import { transitRouteSchema } from "./transit.js";

export const analyzeRequestSchema = z.object({
  city: citySchema,
  work: latLngSchema,
  features: z.array(featureRequestSchema).max(20),
  maxCommuteMin: z.number().min(5).max(180),
  maxWalkToStopM: z.number().min(100).max(2000),
  cellSizeM: z.number().min(200).max(2000),
  /** 0..1: quanto o tempo de trajeto pesa na nota (o resto é proximidade das características). */
  commuteWeight: z.number().min(0).max(1),
  /**
   * Busca flexível: mantém também as áreas que passam um pouco do tempo (até +15 min) ou têm o lugar pedido
   * um pouco mais longe (até 2× o raio), com nota menor e `misses` dizendo quantas coisas faltam.
   */
  flex: z.boolean().optional(),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const cellSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  commuteMin: z.number(),
  /** "a pé" ou o rótulo da linha. */
  via: z.string(),
  routeId: z.string().optional(),
  /** Metros até a característica mais próxima. */
  featureDist: z.record(z.string(), z.number()),
  /** 0..100 */
  score: z.number(),
  region: z.string(),
  /** Busca flexível: quantas coisas a área não cumpre (tempo acima do pedido, lugar além do raio). 0 = tudo. */
  misses: z.number().optional(),
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
  score: z.number(),
  cellCount: z.number(),
  via: z.array(z.string()),
  featureDist: z.record(z.string(), z.number()),
  /** Busca flexível: menor número de coisas que faltam entre as áreas da região (0 = alguma atende tudo). */
  misses: z.number().optional(),
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
    cellsReachable: z.number(),
    cellsMatching: z.number(),
    /** Busca flexível: áreas que ficaram de fora por pouco (entram como "quase lá"). */
    cellsNear: z.number().optional(),
    stopsUsable: z.number(),
  }),
  warnings: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
