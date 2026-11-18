import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import type { Cell, LatLng, Listing } from "@homematch/contracts";
import {
  atLeast,
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

/** Region tab open in the list ("all" = every region). */
export const useRegionTab = create<{ tab: string; setTab: (t: string) => void }>()((set) => ({
  tab: "all",
  setTab: (tab) => set({ tab }),
}));

/**
 * Analyzed cell of a point, among regions at the chosen level (or better) only: the exact one or a neighbor (listing
 * with an approximate position), adding the walk to it. Outside them, the listing is not shown.
 */
function useCellLookup() {
  const analysis = useSearchStore((s) => s.analysis);
  const minLevel = useSearchStore((s) => s.minLevel);
  return useMemo(() => {
    if (!analysis) return null;
    const cells = analysis.cells.filter((c) => atLeast(c.level, minLevel));
    const exact = makeCellLookup(cells, analysis.cellSizeM);
    const wide = makeCellLookup(cells, analysis.cellSizeM, analysis.cellSizeM * 1.25);
    return (l: LatLng): Cell | undefined => {
      const c = exact(l);
      if (c) return c;
      const near = wide(l);
      if (!near) return undefined;
      const extra = Math.max(0, distance(l, near) - analysis.cellSizeM / 2);
      return { ...near, commuteMin: near.commuteMin + walkMin(extra) };
    };
  }, [analysis, minLevel]);
}

/**
 * Listings as the list and the map show them: each with its cell (commute, what is nearby), score and what does not
 * match the request; grouped and sorted. Also favorites and pasted links.
 */
export function useRanked() {
  const { listings, filters, chosen, searchedRegions } = useSearchStore();
  const stats = useSearchStore((s) => s.analysis?.stats);
  const ref = useMemo(() => ({ bestMin: stats?.commuteBestMin ?? 20, refMin: stats?.commuteRefMin ?? 45 }), [stats]);
  const favMap = useFavorites((s) => s.favorites);
  const listMode = useFavorites((s) => s.listMode);
  const linkResults = useLinks((s) => s.results);
  const { tab, setTab } = useRegionTab();
  const features = useFeatures();
  const lookup = useCellLookup();

  // What must be nearby, with the requested radius (to say "grocery 2.6 km away" when beyond it).
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
      // Without an analysis (pasted links only) neither commute nor nearby places can be judged.
      const misses = lookup ? missesOf(l, cell, filters, nearWants) : [];
      return { l, cell, match: matchScore(l, cell, filters, ref), misses };
    },
    [lookup, filters, ref, nearWants],
  );
  // Only listings inside regions with a level (without an analysis, nothing to filter).
  const ranked = useMemo(
    () =>
      sortRanked(
        visibleListings(listings, filters)
          .map(rank)
          .filter((x) => !lookup || x.cell),
        filters,
      ),
    [listings, filters, rank, lookup],
  );
  const inTab = useMemo(() => (tab === "all" ? ranked : ranked.filter((x) => x.l.region === tab)), [ranked, tab]);
  // Favorites: the newest version from the search (if it came back) or the saved one.
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

  // The region tab disappears when the search changes.
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
