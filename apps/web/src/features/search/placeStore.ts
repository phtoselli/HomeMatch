import { create } from "zustand";
import type { City, LatLng, PlaceResult } from "@homematch/contracts";
import { api } from "../../shared/api/client";
import { persistFields, readSaved } from "../../shared/lib/persist";
import { useMapView } from "../map/viewStore";
import { useSearchStore } from "./store";

export type Work = LatLng & { label?: string };

interface PlaceState {
  city: City | null;
  work: Work | null;
  loadingCity: boolean;
  chooseCity: (osmId: string) => Promise<void>;
  chooseWork: (pl: PlaceResult) => void;
  /** Trabalho marcado com um clique no mapa (o nome do lugar chega depois). */
  pickWork: (p: LatLng) => Promise<void>;
}

const shortLabel = (displayName: string) => displayName.split(",").slice(0, 3).join(",");

/** A cidade e o trabalho: o ponto de partida de toda busca. */
export const usePlace = create<PlaceState>()((set) => ({
  city: readSaved<City | null>("city", null),
  work: readSaved<Work | null>("work", null),
  loadingCity: false,

  async chooseCity(osmId) {
    set({ loadingCity: true });
    try {
      const city = await api.city(osmId);
      set({ city });
      useSearchStore.getState().reset();
      useMapView.getState().select(null);
      useMapView.getState().fitTo(city.bbox);
    } finally {
      set({ loadingCity: false });
    }
  },

  chooseWork(pl) {
    set({ work: { lat: pl.lat, lng: pl.lng, label: shortLabel(pl.displayName) } });
    useMapView
      .getState()
      .fitTo({ south: pl.lat - 0.02, north: pl.lat + 0.02, west: pl.lng - 0.02, east: pl.lng + 0.02 });
  },

  async pickWork(p) {
    useMapView.getState().setPickingWork(false);
    set({ work: { ...p, label: "Ponto marcado no mapa" } });
    const r = await api.reverse(p).catch(() => null);
    if (r) set({ work: { ...p, label: shortLabel(r.displayName) } });
  },
}));

persistFields(usePlace, { city: "city", work: "work" });
