import { create } from "zustand";
import type { Listing } from "@homematch/contracts";
import { persistFields, readSaved } from "../../shared/lib/persist";

export type ListMode = "all" | "fav";

interface FavoritesState {
  /** O anúncio inteiro: a busca não fica salva, os favoritos sim (e continuam aparecendo sem buscar de novo). */
  favorites: Record<string, Listing>;
  listMode: ListMode;
  toggle: (l: Listing) => void;
  setListMode: (m: ListMode) => void;
}

export const useFavorites = create<FavoritesState>()((set) => ({
  favorites: readSaved<Record<string, Listing>>("favorites", {}),
  listMode: readSaved<ListMode>("listMode", "all"),
  toggle: (l) =>
    set(({ favorites }) => {
      const next = { ...favorites };
      if (l.id in next) delete next[l.id];
      else next[l.id] = l;
      return { favorites: next };
    }),
  setListMode: (listMode) => set({ listMode }),
}));

persistFields(useFavorites, { favorites: "favorites", listMode: "listMode" });

export const useIsFav = (id: string | undefined) => useFavorites((s) => !!id && id in s.favorites);
