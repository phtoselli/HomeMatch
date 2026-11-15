import { z } from "zod";
import { featureRequestSchema, poiSchema } from "./features.js";
import { bboxSchema, latLngSchema, latLngTupleSchema } from "./geo.js";
import { citySchema } from "./place.js";
import { transitRouteSchema } from "./transit.js";
import { REGION_LEVELS } from "./constants.js";

export const analyzeRequestSchema = z.object({
  city: citySchema,
  work: latLngSchema,
  features: z.array(featureRequestSchema).max(20),
  /**
   * Importância do transporte público até o trabalho: 3 = principal, 2 = importante, 1 = bom ter, 0 = não conta
   * (tem carro). Não há tempo máximo: o tempo de cada região é calculado e mostrado, e conta para o nível.
   */
  transitWeight: z.number().int().min(0).max(3).default(3),
  /** Pontos das linhas que a pessoa escolheu: perto deles, o transporte conta como atingido. [lat, lng] */
  preferredStops: z.array(latLngTupleSchema).max(5000).optional(),
  maxWalkToStopM: z.number().min(100).max(2000),
  cellSizeM: z.number().min(200).max(2000),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
/** O que o app manda (os campos com padrão podem faltar). */
export type AnalyzeInput = z.input<typeof analyzeRequestSchema>;

export const regionLevelSchema = z.enum(REGION_LEVELS);

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
  /** 0..100: soma dos pesos atingidos (ordena dentro do mesmo nível). */
  score: z.number(),
  region: z.string(),
  /** Excelente (a principal e quase tudo), boa (a principal) ou ok (alguma coisa, mas não a principal). */
  level: regionLevelSchema,
  /** Critérios atingidos ("transporte" e ids das características). */
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
  score: z.number(),
  cellCount: z.number(),
  via: z.array(z.string()),
  featureDist: z.record(z.string(), z.number()),
  /** O melhor nível entre as áreas da região. */
  level: regionLevelSchema,
  /** Critérios atingidos na melhor área da região. */
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
    /** Áreas em cada nível. */
    levels: z.object({ excelente: z.number(), boa: z.number(), ok: z.number() }),
    /** Melhor tempo até o trabalho na cidade e o tempo que ainda conta como "transporte atingido". */
    commuteBestMin: z.number(),
    commuteRefMin: z.number(),
    stopsUsable: z.number(),
  }),
  warnings: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
