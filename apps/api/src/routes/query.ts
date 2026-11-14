import { z } from "zod";
import type { BBox, CityRef } from "@homematch/contracts";

/** Retângulo opcional na query string (south, west, north, east): só vale com os quatro. */
export const bboxQuery = {
  south: z.coerce.number().optional(),
  west: z.coerce.number().optional(),
  north: z.coerce.number().optional(),
  east: z.coerce.number().optional(),
};

export function bboxFrom(q: { south?: number; west?: number; north?: number; east?: number }): BBox | undefined {
  return q.south != null && q.west != null && q.north != null && q.east != null
    ? { south: q.south, west: q.west, north: q.north, east: q.east }
    : undefined;
}

/** Cidade na query string (para achar o operador de ônibus dela). */
export const cityQuery = {
  cityId: z.string().optional(),
  cityName: z.string().optional(),
  uf: z.string().optional(),
};

export const cityFrom = (q: { cityId?: string; cityName?: string; uf?: string }): CityRef | null =>
  q.cityName ? { osmId: q.cityId ?? "", name: q.cityName, stateCode: q.uf } : null;
