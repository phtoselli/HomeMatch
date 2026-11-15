import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import type { Cell, LatLng, Listing } from "@homematch/contracts";
import {
  distance,
  makeCellLookup,
  matchScore,
  missesOf,
  sortRanked,
  visibleListings,
  walkMin,
  type NearWant,
  type Ranked,
} from "@homematch/domain";
import { useFeatures } from "@/shared/api/queries";
import { useFavorites } from "@/features/favorites";
import { useLinks } from "@/features/links";
import type { NumberedListing } from "@/features/map";
import { useSearchStore } from "@/features/search";

/** Aba de região aberta na lista ("all" = todas). */
export const useRegionTab = create<{ tab: string; setTab: (t: string) => void }>()((set) => ({
  tab: "all",
  setTab: (tab) => set({ tab }),
}));

/** Célula analisada de um ponto: a exata ou, até ~800 m além das regiões, a vizinha mais a caminhada até ela. */
function useCellLookup() {
  const analysis = useSearchStore((s) => s.analysis);
  return useMemo(() => {
    if (!analysis) return null;
    const exact = makeCellLookup(analysis.cells, analysis.cellSizeM);
    const wide = makeCellLookup(analysis.cells, analysis.cellSizeM, analysis.cellSizeM * 0.75 + 900);
    return (l: LatLng): Cell | undefined => {
      const c = exact(l);
      if (c) return c;
      const near = wide(l);
      if (!near) return undefined;
      const extra = Math.max(0, distance(l, near) - analysis.cellSizeM / 2);
      return { ...near, commuteMin: near.commuteMin + walkMin(extra) };
    };
  }, [analysis]);
}

/**
 * Os imóveis como a lista e o mapa mostram: cada um com a área (trajeto, o que tem perto), a nota
 * e o que não bate com o pedido; agrupados e ordenados. Também os favoritos e os links colados.
 */
export function useRanked() {
  const { listings, filters, chosen, searchedRegions } = useSearchStore();
  const maxMin = useSearchStore((s) => s.params.maxCommuteMin);
  const favMap = useFavorites((s) => s.favorites);
  const listMode = useFavorites((s) => s.listMode);
  const linkResults = useLinks((s) => s.results);
  const { tab, setTab } = useRegionTab();
  const features = useFeatures();
  const lookup = useCellLookup();

  // O que precisa ficar perto, com o raio pedido (para dizer "mercado a 2,6 km" quando passa).
  const nearWants: NearWant[] = useMemo(
    () =>
      features
        .filter((d) => d.id in chosen)
        .map((d) => ({ id: d.id, label: d.label.split(" / ")[0]!, radius: chosen[d.id]! })),
    [features, chosen],
  );
  const rank = useCallback(
    (l: Listing): Ranked => {
      const cell = lookup?.(l);
      // Sem análise (só links colados) não dá para julgar trajeto nem o que tem perto.
      const misses = lookup ? missesOf(l, cell, filters, maxMin, nearWants) : [];
      return { l, cell, match: matchScore(l, cell, filters, maxMin), misses };
    },
    [lookup, filters, maxMin, nearWants],
  );
  const ranked = useMemo(
    () => sortRanked(visibleListings(listings, filters).map(rank), filters),
    [listings, filters, rank],
  );
  const inTab = useMemo(() => (tab === "all" ? ranked : ranked.filter((x) => x.l.region === tab)), [ranked, tab]);
  // Favoritos: o anúncio mais novo da busca (se veio de novo) ou o guardado.
  const favorites = useMemo(() => {
    const live = new Map(listings.map((l) => [l.id, l]));
    return sortRanked(
      Object.values(favMap).map((l) => rank(live.get(l.id) ?? l)),
      filters,
    );
  }, [favMap, listings, rank, filters]);
  const mapListings = useMemo(
    () => (listMode === "fav" ? favorites : inTab).map((x) => x.l),
    [listMode, favorites, inTab],
  );
  const myLinks: NumberedListing[] = useMemo(
    () => linkResults.flatMap((r) => (r.listing ? [{ ...r.listing, index: r.index }] : [])),
    [linkResults],
  );

  // A aba de região deixa de existir quando a busca muda.
  useEffect(() => {
    if (tab !== "all" && !searchedRegions.some((r) => r.name === tab)) setTab("all");
  }, [searchedRegions, tab, setTab]);

  const find = (id: string | null): Ranked | null => {
    if (!id) return null;
    const hit = ranked.find((x) => x.l.id === id) ?? favorites.find((x) => x.l.id === id);
    if (hit) return hit;
    const link = myLinks.find((x) => x.id === id);
    return link ? rank(link) : null;
  };

  return { ranked, favorites, mapListings, myLinks, find };
}
