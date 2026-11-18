import { create } from "zustand";
import type { LinkResult } from "@homematch/contracts";
import { persistFields, readSaved } from "@/shared/lib/persist";

type Update = LinkResult[] | ((prev: LinkResult[]) => LinkResult[]);

interface LinksState {
  /** Listing links pasted by the user (numbered on the map). */
  results: LinkResult[];
  setResults: (v: Update) => void;
}

export const useLinks = create<LinksState>()((set) => ({
  results: readSaved<LinkResult[]>("links", []),
  setResults: (v) => set((s) => ({ results: typeof v === "function" ? v(s.results) : v })),
}));

persistFields(useLinks, { results: "links" });
