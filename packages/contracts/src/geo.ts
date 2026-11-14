import { z } from "zod";

export const latLngSchema = z.object({ lat: z.number(), lng: z.number() });
export type LatLng = z.infer<typeof latLngSchema>;

export const bboxSchema = z.object({ south: z.number(), west: z.number(), north: z.number(), east: z.number() });
export type BBox = z.infer<typeof bboxSchema>;

/** Anel de polígono em [lng, lat] (ordem GeoJSON). Um polígono é [externo, ...buracos]. */
export const ringSchema = z.array(z.tuple([z.number(), z.number()]));
export type Ring = z.infer<typeof ringSchema>;

export const polygonSchema = z.array(ringSchema);
export type Polygon = z.infer<typeof polygonSchema>;

/** Ponto como [lat, lng] (ordem do Leaflet), usado nos traçados. */
export const latLngTupleSchema = z.tuple([z.number(), z.number()]);
export type LatLngTuple = z.infer<typeof latLngTupleSchema>;
