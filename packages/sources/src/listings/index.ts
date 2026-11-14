import type { Listing, ListingsRequest } from "@homematch/contracts";
import { inBBox, padBBox } from "@homematch/domain";
import { extensionSource } from "./core/engine.js";
import { agencySource } from "./discovery.js";
import { chavesNaMao } from "./extensions/chavesnamao.js";
import { lopes } from "./extensions/lopes.js";
import { olx } from "./extensions/olx.js";
import { zapImoveis } from "./extensions/zap.js";
import { matchesFilters } from "@homematch/domain";
import { quintoAndar } from "./quintoandar.js";
import { SourceBlockedError, type SourceAdapter } from "./types.js";
import { vivaReal } from "./vivareal.js";

/**
 * Fontes fixas (portais). QuintoAndar e VivaReal têm código próprio; os outros são extensões
 * (só URL + parse) que rodam no motor comum. Imobiliárias da cidade ("site:host") vêm da descoberta.
 */
export const SOURCES: Record<string, SourceAdapter> = {
  quintoandar: quintoAndar,
  vivareal: vivaReal,
  zapimoveis: extensionSource(zapImoveis),
  chavesnamao: extensionSource(chavesNaMao),
  lopes: extensionSource(lopes),
  olx: extensionSource(olx),
};

async function resolveSource(id: string): Promise<SourceAdapter | null> {
  if (SOURCES[id]) return SOURCES[id];
  if (id.startsWith("site:")) return agencySource(id);
  return null;
}

type Emit = (ev: { type: "progress" | "warning"; message: string } | { type: "partial"; data: Listing[] }) => void;

/** Mesmo imóvel em dois sites: mesmo preço, quartos e área a menos de ~60 m. */
function dupKey(l: Listing): string | null {
  if (l.approxLocation || !l.area) return null;
  return `${Math.round(l.lat * 1800)}:${Math.round(l.lng * 1800)}:${l.total}:${l.bedrooms ?? "?"}:${l.area}`;
}

/**
 * Busca anúncios em cada região escolhida, em todas as fontes (fontes em paralelo,
 * regiões em sequência dentro de cada fonte para respeitar o ritmo de cada site).
 */
export async function searchListings(req: ListingsRequest, emit: Emit): Promise<Listing[]> {
  const all = new Map<string, Listing>();
  const dups = new Set<string>();
  await Promise.all(
    req.sources.map(async (sid) => {
      const src = await resolveSource(sid).catch(() => null);
      if (!src) {
        emit({ type: "warning", message: `${sid}: fonte desconhecida ou que não dá para ler agora; pulando.` });
        return;
      }
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
            const k = dupKey(l);
            if (k && dups.has(k)) continue; // o mesmo imóvel anunciado em outro site
            if (k) dups.add(k);
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
