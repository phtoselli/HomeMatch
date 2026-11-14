import type { SourceId } from "@homematch/contracts";
import { useSources } from "../../shared/api/queries";
import { usePlace } from "./placeStore";
import { useSearchStore } from "./store";

/** Antes de saber o que a cidade tem (ou se a descoberta falhar): os portais. */
const FALLBACK_SOURCES: SourceId[] = ["quintoandar", "chavesnamao", "zapimoveis", "vivareal", "lopes", "olx"];

/**
 * A busca como os componentes a usam: o store (pedido + resultados) mais as fontes da cidade.
 * Fontes = todas as que dá para ler na cidade, menos as que a pessoa desmarcou.
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
