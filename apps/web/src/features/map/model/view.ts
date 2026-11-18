import { create } from "zustand";
import type { BBox } from "@homematch/contracts";

interface MapViewState {
  /** Request to fit the map (key changes on every request, even for the same rectangle). */
  fit: { bbox: BBox; key: number } | null;
  /** Currently visible area (to search lines "here"). */
  viewBBox: BBox | null;
  /** Selected listing (map card), the one open in detail and the one the map should center on. */
  selectedId: string | null;
  detailId: string | null;
  focusId: string | null;
  /** Waiting for a click on the map to mark work. */
  pickingWork: boolean;
  settingsOpen: boolean;

  fitTo: (bbox: BBox) => void;
  setViewBBox: (b: BBox | null) => void;
  select: (id: string | null) => void;
  /** Selects from the list and centers the map on the listing. */
  selectAndFocus: (id: string) => void;
  openDetail: (id: string | null) => void;
  setPickingWork: (on: boolean) => void;
  setSettingsOpen: (on: boolean) => void;
}

export const useMapView = create<MapViewState>()((set) => ({
  fit: null,
  viewBBox: null,
  selectedId: null,
  detailId: null,
  focusId: null,
  pickingWork: false,
  settingsOpen: false,

  fitTo: (bbox) => set({ fit: { bbox, key: Date.now() } }),
  setViewBBox: (viewBBox) => set({ viewBBox }),
  select: (selectedId) => set({ selectedId }),
  selectAndFocus: (id) => {
    // Reset and set again: clicking the same listing twice re-centers it.
    set({ selectedId: id, focusId: null });
    setTimeout(() => set({ focusId: id }), 0);
  },
  openDetail: (detailId) => set({ detailId }),
  setPickingWork: (pickingWork) => set({ pickingWork }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
