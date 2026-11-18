import { z } from "zod";

/** Something the user wants near home (grocery store, park…). */
export const featureDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  emoji: z.string(),
  color: z.string(),
  /** Meters. */
  defaultRadius: z.number(),
  description: z.string(),
});
export type FeatureDef = z.infer<typeof featureDefSchema>;

export const featureRequestSchema = z.object({
  id: z.string(),
  /** Meters. */
  radius: z.number().min(100).max(10_000),
  /** Importance: 3 = main, 2 = important, 1 = nice to have. */
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
