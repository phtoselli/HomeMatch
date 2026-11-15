import { create } from "zustand";
import type { BBox, BusLine, CityRef } from "@homematch/contracts";
import { api } from "@/shared/api/client";
import { readSaved, writeSaved } from "@/shared/lib/persist";

type Update = BusLine[] | ((prev: BusLine[]) => BusLine[]);

interface LinesState {
  /** Linhas que a pessoa pôs no mapa (pelo número ou "perto do trabalho"). */
  lines: BusLine[];
  /** Ids salvos que não voltaram (Overpass fora do ar etc.): continuam salvos para a próxima vez. */
  unrestored: string[];
  restoring: boolean;
  /** Busca de novo as linhas salvas (guarda só o id; o servidor tem cache). */
  restore: (city: CityRef | null) => Promise<void>;
  /** Mudança vinda da tela (adicionar, remover, limpar): remover também esquece as que não voltaram. */
  setLines: (v: Update) => void;
  /** Põe uma linha no mapa pelo número; devolve a frase para mostrar. */
  addLine: (q: string, city: CityRef | null, box: BBox | undefined) => Promise<string>;
}

const savedIds = () => readSaved<string[]>("busLines", []);

export const useLines = create<LinesState>()((set, get) => ({
  lines: [],
  unrestored: [],
  restoring: false,

  async restore(city) {
    const ids = savedIds();
    if (!ids.length) return;
    set({ restoring: true });
    const failed: string[] = [];
    await Promise.allSettled(
      ids.map((id) => {
        const q = id.includes(":") ? id : `https://www.openstreetmap.org/relation/${id}`;
        return api.bus(q, undefined, city).then(
          (found) => {
            if (!found.length) failed.push(id);
            set((s) => ({ lines: [...s.lines.filter((x) => x.id !== id), ...found] }));
          },
          () => failed.push(id),
        );
      }),
    );
    set({ restoring: false, unrestored: failed });
  },

  setLines(v) {
    set((s) => {
      const next = typeof v === "function" ? v(s.lines) : v;
      const kept = new Set(next.map((l) => l.id));
      const removed = new Set(s.lines.filter((l) => !kept.has(l.id)).map((l) => l.id));
      return { lines: next, unrestored: next.length ? s.unrestored.filter((id) => !removed.has(id)) : [] };
    });
  },

  async addLine(q, city, box) {
    try {
      const found = await api.bus(q, box, city);
      if (!found.length) return `Não achei a linha "${q}"${city ? ` em ${city.name}` : ""}.`;
      get().setLines((prev) => [...prev.filter((l) => !found.some((f) => f.id === l.id)), ...found]);
      const stops = found.reduce((n, l) => n + l.stops.length, 0);
      return `Linha ${found[0]!.ref ?? q} no mapa (${found.length} ${found.length === 1 ? "sentido" : "sentidos"}, ${stops} pontos).`;
    } catch (e) {
      return (e as Error).message;
    }
  },
}));

// Salva os ids (as que estão no mapa + as que não voltaram). Durante a restauração não grava,
// senão a lista salva vira [] antes de as linhas chegarem.
useLines.subscribe((s, prev) => {
  if (s.restoring || (s.lines === prev.lines && s.unrestored === prev.unrestored && s.restoring === prev.restoring))
    return;
  writeSaved("busLines", [...new Set([...s.lines.map((l) => l.id), ...s.unrestored])]);
});
