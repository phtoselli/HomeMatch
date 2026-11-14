import { z } from "zod";
import { bboxSchema, polygonSchema } from "./geo.js";

/** Id do OpenStreetMap: tipo + número ("R298285" = relation, "N123" = node, "W45" = way). */
export const osmIdSchema = z.string().regex(/^[NWR]\d+$/, "id do OpenStreetMap inválido");
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
  /** "SP" */
  stateCode: z.string().optional(),
});
export type PlaceResult = z.infer<typeof placeResultSchema>;

export const citySchema = placeResultSchema.extend({
  /** Multipolígono do limite municipal. */
  boundary: z.array(polygonSchema).optional(),
});
export type City = z.infer<typeof citySchema>;

/** O mínimo para saber de que cidade se fala (operador de ônibus, fontes de anúncio). */
export type CityRef = Pick<PlaceResult, "osmId" | "name" | "stateCode">;
