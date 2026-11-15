import { create } from "zustand";
import type { City } from "@homematch/contracts";
import { persistFields, readSaved } from "@/shared/lib/persist";
import { useMapView } from "@/features/map";

/** explore = regiões + imóveis da busca; links = anúncios colados e linhas de ônibus. */
export type Mode = "explore" | "links";

interface ShellState {
  mode: Mode;
  setupOpen: boolean;
  setupStep: number;
  /** Trocar de modo fecha a configuração (ela cobre o painel e o mapa: senão nada muda na tela). */
  setMode: (m: Mode) => void;
  openSetup: (step: number) => void;
  closeSetup: () => void;
}

// Sem cidade e trabalho, o app abre direto na configuração.
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
