import type { SourceId } from "@homematch/contracts";
import { useSources } from "@/shared/api/queries";
import { usePlace } from "../model/place";
import { useSearchStore } from "../model/search";

/** Before knowing what the city has (or if discovery fails): the portals. */
const FALLBACK_SOURCES: SourceId[] = ["quintoandar", "chavesnamao", "zapimoveis", "vivareal", "lopes", "olx"];

/**
 * The search as components use it: the store (request + results) plus the city's sources.
 * Sources = every readable source in the city, minus the ones the user unchecked.
 */
export function useSearch() {
  const store = useSearchStore();
  const city = usePlace((s) => s.city);
  const sourcesQuery = useSources(city);
  const available = sourcesQuery.data ?? null;
  const readable = available ? [...available.portals, ...available.agencies].filter((x) => x.status === "ok") : null;
  const sources = (readable?.map((x) => x.id) ?? FALLBACK_SOURCES).filter((id) => !store.disabledSources.includes(id));
  return { ...store, available, loadingSources: sourcesQuery.isFetching, sources };
}

export type Search = ReturnType<typeof useSearch>;
