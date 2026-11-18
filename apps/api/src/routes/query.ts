import { z } from "zod";
import { latitudeSchema, longitudeSchema, type BBox, type CityRef } from "@homematch/contracts";

/** Coordinate in the query string (arrives as text). */
export const latQuery = z.coerce.number().pipe(latitudeSchema);
export const lngQuery = z.coerce.number().pipe(longitudeSchema);

/** Optional rectangle in the query string (south, west, north, east): only valid with all four. */
export const bboxQuery = {
  south: latQuery.optional(),
  west: lngQuery.optional(),
  north: latQuery.optional(),
  east: lngQuery.optional(),
};

export function bboxFrom(q: { south?: number; west?: number; north?: number; east?: number }): BBox | undefined {
  return q.south != null && q.west != null && q.north != null && q.east != null
    ? { south: q.south, west: q.west, north: q.north, east: q.east }
    : undefined;
}

/** City in the query string (to find its bus operator). */
export const cityQuery = {
  cityId: z.string().max(40).optional(),
  cityName: z.string().max(120).optional(),
  uf: z.string().max(4).optional(),
};

export const cityFrom = (q: { cityId?: string; cityName?: string; uf?: string }): CityRef | null =>
  q.cityName ? { osmId: q.cityId ?? "", name: q.cityName, stateCode: q.uf } : null;
