import { z } from "zod";
import { latitudeSchema, longitudeSchema, type BBox, type CityRef } from "@homematch/contracts";

/** Coordenada na query string (vem como texto). */
export const latQuery = z.coerce.number().pipe(latitudeSchema);
export const lngQuery = z.coerce.number().pipe(longitudeSchema);

/** Retângulo opcional na query string (south, west, north, east): só vale com os quatro. */
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

/** Cidade na query string (para achar o operador de ônibus dela). */
export const cityQuery = {
  cityId: z.string().max(40).optional(),
  cityName: z.string().max(120).optional(),
  uf: z.string().max(4).optional(),
};

export const cityFrom = (q: { cityId?: string; cityName?: string; uf?: string }): CityRef | null =>
  q.cityName ? { osmId: q.cityId ?? "", name: q.cityName, stateCode: q.uf } : null;
