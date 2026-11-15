import { create } from "zustand";
import type { BBox } from "@homematch/contracts";

interface MapViewState {
  /** Pedido para enquadrar o mapa (key muda a cada pedido, mesmo para o mesmo retângulo). */
  fit: { bbox: BBox; key: number } | null;
  /** Área visível agora (para buscar linhas "aqui"). */
  viewBBox: BBox | null;
  /** Imóvel selecionado (cartão no mapa), aberto em detalhe e o que o mapa deve centralizar. */
  selectedId: string | null;
  detailId: string | null;
  focusId: string | null;
  /** Esperando um clique no mapa para marcar o trabalho. */
  pickingWork: boolean;
  settingsOpen: boolean;

  fitTo: (bbox: BBox) => void;
  setViewBBox: (b: BBox | null) => void;
  select: (id: string | null) => void;
  /** Seleciona pela lista e centraliza o mapa no imóvel. */
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
    // Zera e marca de novo: clicar duas vezes no mesmo imóvel volta a centralizar.
    set({ selectedId: id, focusId: null });
    setTimeout(() => set({ focusId: id }), 0);
  },
  openDetail: (detailId) => set({ detailId }),
  setPickingWork: (pickingWork) => set({ pickingWork }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
