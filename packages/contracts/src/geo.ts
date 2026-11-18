import { z } from "zod";

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const latLngSchema = z.object({ lat: latitudeSchema, lng: longitudeSchema });
export type LatLng = z.infer<typeof latLngSchema>;

export const bboxSchema = z.object({
  south: latitudeSchema,
  west: longitudeSchema,
  north: latitudeSchema,
  east: longitudeSchema,
});
export type BBox = z.infer<typeof bboxSchema>;

/** Polygon ring as [lng, lat] (GeoJSON order). A polygon is [outer, ...holes]. */
export const ringSchema = z.array(z.tuple([z.number(), z.number()]));
export type Ring = z.infer<typeof ringSchema>;

export const polygonSchema = z.array(ringSchema);
export type Polygon = z.infer<typeof polygonSchema>;

/** Point as [lat, lng] (Leaflet order), used for route geometry. */
export const latLngTupleSchema = z.tuple([z.number(), z.number()]);
export type LatLngTuple = z.infer<typeof latLngTupleSchema>;
