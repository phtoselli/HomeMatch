import { z } from "zod";
import { t } from "@homematch/i18n";
import { bboxSchema, polygonSchema } from "./geo.js";

/** OpenStreetMap id: element type + number ("R298285" = relation, "N123" = node, "W45" = way). */
export const osmIdSchema = z.string().regex(/^[NWR]\d+$/, t.api.invalidOsmId);
export type OsmId = z.infer<typeof osmIdSchema>;

export const placeResultSchema = z.object({
  osmId: z.string(),
  name: z.string(),
  displayName: z.string(),
  lat: z.number(),
  lng: z.number(),
  bbox: bboxSchema,
  /** city, town, road, house… */
  kind: z.string(),
  city: z.string().optional(),
  state: z.string().optional(),
  /** Two-letter state code, e.g. "SP". */
  stateCode: z.string().optional(),
});
export type PlaceResult = z.infer<typeof placeResultSchema>;

export const citySchema = placeResultSchema.extend({
  /** City limits as a multipolygon. */
  boundary: z.array(polygonSchema).optional(),
});
export type City = z.infer<typeof citySchema>;

/** The minimum needed to tell which city we mean (transit operator, listing sources). */
export type CityRef = Pick<PlaceResult, "osmId" | "name" | "stateCode">;
