import { create } from "zustand";
import type { City } from "@homematch/contracts";
import { persistFields, readSaved } from "@/shared/lib/persist";
import { useMapView } from "@/features/map";

/** explore = regions + listings from the search; links = pasted listings and bus lines. */
export type Mode = "explore" | "links";

interface ShellState {
  mode: Mode;
  setupOpen: boolean;
  setupStep: number;
  /** Switching mode closes the setup (it covers the panel and the map: otherwise nothing seems to change). */
  setMode: (m: Mode) => void;
  openSetup: (step: number) => void;
  closeSetup: () => void;
}

// Without a city and work location, the app opens straight into the setup.
const needsSetup = !(readSaved<City | null>("city", null) && readSaved("work", null));

export const useShell = create<ShellState>()((set) => ({
  mode: readSaved<Mode>("mode", "explore"),
  setupOpen: needsSetup,
  setupStep: 0,
  setMode: (mode) => {
    set({ mode, setupOpen: false });
    useMapView.getState().setPickingWork(false);
  },
  openSetup: (setupStep) => set({ setupStep, setupOpen: true }),
  closeSetup: () => set({ setupOpen: false }),
}));

persistFields(useShell, { mode: "mode" });
