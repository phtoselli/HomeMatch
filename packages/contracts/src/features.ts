import { z } from "zod";

/** Uma característica que a pessoa quer ter perto de casa (mercado, parque…). */
export const featureDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  emoji: z.string(),
  color: z.string(),
  /** Metros. */
  defaultRadius: z.number(),
  description: z.string(),
});
export type FeatureDef = z.infer<typeof featureDefSchema>;

export const featureRequestSchema = z.object({
  id: z.string(),
  /** Metros. */
  radius: z.number().min(100).max(10_000),
  /** Importância: 3 = principal, 2 = importante, 1 = bom ter. */
  weight: z.number().int().min(1).max(3).default(2),
});
export type FeatureRequest = z.infer<typeof featureRequestSchema>;

export const poiSchema = z.object({
  id: z.string(),
  feature: z.string(),
  lat: z.number(),
  lng: z.number(),
  name: z.string().optional(),
});
export type Poi = z.infer<typeof poiSchema>;
