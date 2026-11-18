import { create } from "zustand";
import type { BBox, BusLine, CityRef, LatLng } from "@homematch/contracts";
import { api } from "@/shared/api/client";
import { readSaved, writeSaved } from "@/shared/lib/persist";
import { t } from "@homematch/i18n";

type Update = BusLine[] | ((prev: BusLine[]) => BusLine[]);

interface LinesState {
  /** Lines the user put on the map (by number or "near work"). */
  lines: BusLine[];
  /** Saved ids that did not come back (Overpass down etc.): they stay saved for next time. */
  unrestored: string[];
  restoring: boolean;
  /** Fetches the saved lines again (only ids are saved; the server has a cache). */
  restore: (city: CityRef | null, work?: LatLng | null) => Promise<void>;
  /** A change from the UI (add, remove, clear): removing also forgets the ones that did not come back. */
  setLines: (v: Update) => void;
  /** Puts a line on the map by number; returns the sentence to display. */
  addLine: (q: string, city: CityRef | null, box: BBox | undefined, work?: LatLng | null) => Promise<string>;
}

const savedIds = () => readSaved<string[]>("busLines", []);

export const useLines = create<LinesState>()((set, get) => ({
  lines: [],
  unrestored: [],
  restoring: false,

  async restore(city, work) {
    const ids = savedIds();
    if (!ids.length) return;
    set({ restoring: true });
    const failed: string[] = [];
    await Promise.allSettled(
      ids.map((id) => {
        const q = id.includes(":") ? id : `https://www.openstreetmap.org/relation/${id}`;
        return api.bus(q, undefined, city, work).then(
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

  async addLine(q, city, box, work) {
    try {
      const found = await api.bus(q, box, city, work);
      if (!found.length) return t.ui.transit.lineNotFound(q, city?.name);
      get().setLines((prev) => [...prev.filter((l) => !found.some((f) => f.id === l.id)), ...found]);
      const stops = found.reduce((n, l) => n + l.stops.length, 0);
      return `Linha ${found[0]!.ref ?? q} no mapa (${found.length} ${found.length === 1 ? "sentido" : "sentidos"}, ${stops} pontos).`;
    } catch (e) {
      return (e as Error).message;
    }
  },
}));

// Saves the ids (lines on the map + those that did not come back). Nothing is written while restoring,
// otherwise the saved list would become [] before the lines arrive.
useLines.subscribe((s, prev) => {
  if (s.restoring || (s.lines === prev.lines && s.unrestored === prev.unrestored && s.restoring === prev.restoring))
    return;
  writeSaved("busLines", [...new Set([...s.lines.map((l) => l.id), ...s.unrestored])]);
});
