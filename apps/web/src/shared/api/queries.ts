import { QueryClient, useQuery } from "@tanstack/react-query";
import type { CityRef, FeatureDef, LatLng } from "@homematch/contracts";
import { api } from "./client";

/**
 * Leituras simples da API (GET), com cache e sem pedido repetido: TanStack Query.
 * As buscas longas em streaming (análise, imóveis, links) ficam nos stores, com o andamento na tela.
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

/** O que dá para pedir perto de casa (mercado, parque…). Não muda enquanto o app está aberto. */
export const useFeatures = (): FeatureDef[] =>
  useQuery({ queryKey: queryKeys.features, queryFn: api.features, staleTime: Infinity }).data ?? NO_FEATURES;

/** Portais + imobiliárias da cidade (a 1ª vez numa cidade leva ~30 s: o servidor visita o site de cada uma). */
export const useSources = (city: Pick<CityRef, "osmId"> | null) =>
  useQuery({ queryKey: queryKeys.sources(city?.osmId), queryFn: () => api.sources(city), staleTime: 60 * 60_000 });

/** Quem publica as linhas de ônibus da cidade, ou da cidade do trabalho (ex.: morando em Paulínia → EMDEC). */
export const useOperator = (city: CityRef | null, work?: LatLng | null) =>
  useQuery({
    queryKey: queryKeys.operator(city?.osmId, work ? `${work.lat.toFixed(3)},${work.lng.toFixed(3)}` : null),
    queryFn: () => api.operator(city!, work),
    enabled: !!city,
    staleTime: Infinity,
  });

/** Grade de horários de uma linha ("emdec:353"). Passar o mouse várias vezes não repete o pedido. */
export const useTimetable = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.timetable(id),
    queryFn: () => api.timetable(id!),
    enabled: !!id,
    staleTime: 60 * 60_000,
  });
