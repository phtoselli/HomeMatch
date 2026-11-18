import { QueryClient, useQuery } from "@tanstack/react-query";
import type { CityRef, FeatureDef, LatLng } from "@homematch/contracts";
import { api } from "./client";

/**
 * Simple API reads (GET), cached and deduplicated: TanStack Query.
 * The long streamed searches (analysis, listings, links) live in the stores, with progress on screen.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
  },
});

export const queryKeys = {
  features: ["features"] as const,
  sources: (cityId: string | undefined) => ["sources", cityId ?? null] as const,
  operator: (cityId: string | undefined, work?: string | null) => ["operator", cityId ?? null, work ?? null] as const,
  timetable: (id: string | undefined) => ["timetable", id ?? null] as const,
};

const NO_FEATURES: FeatureDef[] = [];

/** What can be requested near home (grocery, park…). Does not change while the app is open. */
export const useFeatures = (): FeatureDef[] =>
  useQuery({ queryKey: queryKeys.features, queryFn: api.features, staleTime: Infinity }).data ?? NO_FEATURES;

/** Portals + the city's agencies (the first time in a city takes ~30 s: the server visits each website). */
export const useSources = (city: Pick<CityRef, "osmId"> | null) =>
  useQuery({ queryKey: queryKeys.sources(city?.osmId), queryFn: () => api.sources(city), staleTime: 60 * 60_000 });

/** Who publishes the city's bus lines, or the work city's (e.g. living in Paulínia → EMDEC). */
export const useOperator = (city: CityRef | null, work?: LatLng | null) =>
  useQuery({
    queryKey: queryKeys.operator(city?.osmId, work ? `${work.lat.toFixed(3)},${work.lng.toFixed(3)}` : null),
    queryFn: () => api.operator(city!, work),
    enabled: !!city,
    staleTime: Infinity,
  });

/** Timetable of a line ("emdec:353"). Hovering many times does not repeat the request. */
export const useTimetable = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.timetable(id),
    queryFn: () => api.timetable(id!),
    enabled: !!id,
    staleTime: 60 * 60_000,
  });
