import type { Listing, ListingsRequest, SourceId } from "../../shared/types.js";
import { inBBox, padBBox } from "../geo.js";
import { matchesFilters } from "./normalize.js";
import { quintoAndar } from "./quintoandar.js";
import { SourceBlockedError, type SourceAdapter } from "./types.js";
import { vivaReal } from "./vivareal.js";

export const SOURCES: Record<SourceId, SourceAdapter> = {
  quintoandar: quintoAndar,
  vivareal: vivaReal,
};

type Emit = (ev: { type: "progress" | "warning"; message: string } | { type: "partial"; data: Listing[] }) => void;

/**
 * Busca anúncios em cada região escolhida, em todas as fontes (fontes em paralelo,
 * regiões em sequência dentro de cada fonte para respeitar o ritmo de cada site).
 */
export async function searchListings(req: ListingsRequest, emit: Emit): Promise<Listing[]> {
  const all = new Map<string, Listing>();
  await Promise.all(
    req.sources.map(async (sid) => {
      const src = SOURCES[sid];
      if (!src) return;
      for (const region of req.regions) {
        try {
          const got = await src.search({
            city: req.city,
            region,
            max: req.maxPerRegion,
            filters: req.filters,
            log: (message) => emit({ type: "progress", message }),
          });
          const box = padBBox(region.bbox, 800);
          const fresh: Listing[] = [];
          for (const l of got) {
            if (!l.approxLocation && !inBBox(l, box)) continue; // fora da região pedida
            if (!matchesFilters(l, req.filters)) continue; // o site nem sempre aplica todos os filtros
            if (all.has(l.id)) continue;
            const withRegion = { ...l, region: region.name };
            all.set(l.id, withRegion);
            fresh.push(withRegion);
          }
          if (fresh.length) emit({ type: "partial", data: fresh });
        } catch (e) {
          if (e instanceof SourceBlockedError) {
            emit({ type: "warning", message: `${src.label}: ${e.message}. Pulando as outras regiões nessa fonte.` });
            break;
          }
          emit({ type: "warning", message: `${src.label} · ${region.name}: falhou (${(e as Error).message})` });
        }
      }
    }),
  );
  return [...all.values()];
}
