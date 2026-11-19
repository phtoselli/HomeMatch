import { create } from "zustand";
import type { AnalysisResult, BBox, City, LatLng, Listing, Region, RegionLevel, SourceId } from "@homematch/contracts";
import {
  DEFAULT_FILTERS,
  DEFAULT_PARAMS,
  IMPORTANCE,
  TRANSIT_CRITERION,
  atLeast,
  diagnose,
  normalizeFilters,
  normalizeParams,
  wideFilters,
  type Diagnosis,
  type Filters,
  type Importance,
  type Params,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { api } from "@/shared/api/client";
import { persistFields, readSaved } from "@/shared/lib/persist";

const msg = t.ui.search;

/** How many of the best regions enter the automatic listing search. */
export const TOP_REGIONS = 5;
/** With fewer listings than this, the search widens by itself to the next regions (up to MAX_REGIONS). */
export const ENOUGH_LISTINGS = 25;
export const MAX_REGIONS = 15;

export type Busy = "analyze" | "listings" | null;

export interface RunAllArgs {
  city: City;
  work: LatLng;
  sources: SourceId[];
  onFit: (b: BBox) => void;
  /** Stops of the lines the user added (near them, transit counts as met). */
  preferredStops?: [number, number][];
}

/**
 * Importance of each criterion ("transit" and place ids): 3 = main (only one), 2 = important, 1 = nice to have;
 * transit may also be 0 (not used, has a car).
 */
export type Priorities = Record<string, Importance | 0>;

export const DEFAULT_PRIORITIES: Priorities = { [TRANSIT_CRITERION]: IMPORTANCE.main };

/** Importance of a criterion (a place without a saved value = important; transit without one = main). */
export function importanceOf(p: Priorities, id: string): Importance | 0 {
  const v = p[id];
  if (v != null) return v;
  return id === TRANSIT_CRITERION ? IMPORTANCE.main : IMPORTANCE.important;
}

/**
 * Changes a criterion's importance. Only one is main: picking another demotes the previous one to "important".
 * `ids` are the criteria in use (transit and the chosen places).
 */
export function setImportance(p: Priorities, ids: string[], id: string, v: Importance | 0): Priorities {
  const out: Priorities = { ...p, [id]: v };
  if (v === IMPORTANCE.main)
    for (const other of ids) if (other !== id && importanceOf(out, other) === IMPORTANCE.main) out[other] = 2;
  // The main one was removed: the next most important criterion takes over (there is always a visible main).
  if (!ids.some((x) => importanceOf(out, x) === IMPORTANCE.main)) {
    const next =
      mainOf(
        out,
        ids.filter((x) => x !== id),
      ) ?? (v > 0 ? id : undefined);
    if (next) out[next] = IMPORTANCE.main;
  }
  return out;
}

/** The main criterion among those in use (the first with the highest importance). */
export function mainOf(p: Priorities, ids: string[]): string | undefined {
  let best: string | undefined;
  for (const id of ids)
    if (importanceOf(p, id) > 0 && (!best || importanceOf(p, id) > importanceOf(p, best))) best = id;
  return best;
}

interface SearchState {
  // ---- what the user asks for (saved in the browser) ----
  /** Feature → radius in meters (what the user wants near home). */
  chosen: Record<string, number>;
  params: Params;
  priorities: Priorities;
  /** Minimum level of the regions shown (on the map, in the region list and for listings). */
  minLevel: RegionLevel;
  filters: Filters;
  /** Unchecked sources: new sources showing up in the city start checked. */
  disabledSources: SourceId[];
  /** Agency websites the user added (the server checks and reads them like the others). */
  extraAgencies: string[];
  maxPerRegion: number;
  // ---- what the search found (gone after a reload) ----
  analysis: AnalysisResult | null;
  listings: Listing[];
  selectedRegions: Set<string>;
  /** Regions where the listed properties were searched (list tabs). */
  searchedRegions: Region[];
  busy: Busy;
  log: string[];
  /** Search warnings (a site that blocked, a region that failed): all are kept; the log keeps only the latest. */
  warnings: string[];
  error: string | null;
  /** Filters used in the last search: loosening one requires searching again. */
  searchedWith: string | null;
  /** When the search comes back empty: what exists just above the cap and in other types. */
  diagnosis: Diagnosis | null;

  setChosen: (c: Record<string, number>) => void;
  setParams: (p: Params) => void;
  setPriorities: (p: Priorities) => void;
  setMinLevel: (l: RegionLevel) => void;
  setFilters: (f: Filters) => void;
  setSourceEnabled: (id: SourceId, on: boolean) => void;
  addAgency: (site: string) => void;
  removeAgency: (site: string) => void;
  setMaxPerRegion: (n: number) => void;
  setSelectedRegions: (s: Set<string>) => void;
  reset: () => void;
  runListings: (
    city: City,
    regions: Region[],
    sources: SourceId[],
    filters?: Filters,
    more?: Region[],
  ) => Promise<void>;
  runAll: (args: RunAllArgs) => Promise<void>;
}

const EMPTY_RESULTS = {
  analysis: null,
  listings: [],
  searchedRegions: [],
  searchedWith: null,
  diagnosis: null,
  log: [],
  warnings: [],
  error: null,
} satisfies Partial<SearchState>;

export const useSearchStore = create<SearchState>()((set, get) => {
  /** One progress line; warnings also go to the warning list (one per source). */
  const say = (message: string, warning = false) =>
    set((s) => {
      const log = [...s.log.slice(-7), warning ? msg.warningLine(message) : message];
      if (!warning) return { log };
      // The widened search runs in batches and would repeat the same block: one warning per source ("OLX: …").
      const key = (x: string) => x.split(":")[0];
      return {
        log,
        warnings: s.warnings.some((x) => key(x) === key(message)) ? s.warnings : [...s.warnings, message],
      };
    });
  const onProgress = (ev: { type: string; message?: string }) => {
    if (ev.type === "progress" || ev.type === "warning") say(ev.message ?? "", ev.type === "warning");
  };

  return {
    chosen: readSaved("features", { wholesale_market: 2000, park: 1500 }),
    params: normalizeParams(readSaved<Partial<Params>>("params", DEFAULT_PARAMS)),
    priorities: readSaved("priorities", DEFAULT_PRIORITIES),
    minLevel: readSaved<RegionLevel>("minLevel", "ok"),
    filters: normalizeFilters(readSaved<Partial<Filters>>("filters", DEFAULT_FILTERS)),
    disabledSources: readSaved<SourceId[]>("disabledSources", []),
    extraAgencies: readSaved<string[]>("extraAgencies", []),
    maxPerRegion: readSaved("maxPerRegion", 100),
    ...EMPTY_RESULTS,
    selectedRegions: new Set(),
    busy: null,

    setChosen: (chosen) => set({ chosen }),
    setParams: (params) => set({ params }),
    setPriorities: (priorities) => set({ priorities }),
    setMinLevel: (minLevel) => set({ minLevel }),
    setFilters: (filters) => set({ filters: normalizeFilters(filters) }),
    addAgency: (site) => set(({ extraAgencies: x }) => ({ extraAgencies: [...new Set([...x, site])].slice(-10) })),
    removeAgency: (site) => set(({ extraAgencies: x }) => ({ extraAgencies: x.filter((s) => s !== site) })),
    setSourceEnabled: (id, on) =>
      set(({ disabledSources: d }) => ({ disabledSources: on ? d.filter((x) => x !== id) : [...new Set([...d, id])] })),
    setMaxPerRegion: (maxPerRegion) => set({ maxPerRegion }),
    setSelectedRegions: (selectedRegions) => set({ selectedRegions }),
    reset: () => set(EMPTY_RESULTS),

    /**
     * Searches listings in the given regions. With few results, it continues by itself through the next regions in
     * `more` (in batches of TOP_REGIONS), so the user does not have to adjust anything to see options.
     */
    async runListings(city, regions, sources, filters = get().filters, more = []) {
      if (!regions.length) return;
      set({ busy: "listings", error: null, listings: [], diagnosis: null, searchedRegions: regions });
      // The site search is wider than the request; near misses show up as "almost there".
      const sf = wideFilters(filters);
      const cityRef = { name: city.name, stateCode: city.stateCode, bbox: city.bbox };
      const { maxPerRegion } = get();
      const fetchIn = (rs: Region[]) =>
        api.listings({ city: cityRef, regions: rs, sources, maxPerRegion, filters: sf }, (ev) => {
          if (ev.type !== "partial") return onProgress(ev);
          set((s) => {
            const have = new Set(s.listings.map((x) => x.id));
            return { listings: [...s.listings, ...ev.data.filter((x) => !have.has(x.id))] };
          });
        });
      try {
        const ids = new Set((await fetchIn(regions)).map((l) => l.id));
        let searched = regions;
        let rest = more.filter((r) => !regions.some((x) => x.id === r.id));
        while (ids.size < ENOUGH_LISTINGS && rest.length && searched.length < MAX_REGIONS) {
          const next = rest.slice(0, Math.min(TOP_REGIONS, MAX_REGIONS - searched.length));
          rest = rest.slice(next.length);
          say(msg.widening(ids.size, next.length));
          searched = [...searched, ...next];
          set({ searchedRegions: searched, selectedRegions: new Set(searched.map((r) => r.id)) });
          for (const l of await fetchIn(next)) ids.add(l.id);
        }
        set({ searchedWith: JSON.stringify(sf) });
        if (!ids.size && sources.length) {
          // Nothing with these filters: look at what exists just above the cap and in other types, to explain why
          // and suggest an adjustment (otherwise the screen would just be empty).
          say(msg.diagnosing);
          const probe = (f: typeof sf) =>
            api
              .listings({ city: cityRef, regions, sources, maxPerRegion: 60, filters: f }, () => {})
              .catch(() => [] as Listing[]);
          const ceiling = sf.priceMax;
          const same = await probe({ ...sf, priceMin: null, priceMax: ceiling ? Math.round(ceiling * 1.6) : null });
          const any = await probe({ ...sf, types: [], minBedrooms: 0, minBathrooms: 0, minParking: 0, minArea: 0 });
          set({ diagnosis: diagnose(same, any, filters) });
        }
        say(msg.listingsDone);
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set({ busy: null });
      }
    },

    /** Finds the regions and searches listings in the best ones. */
    async runAll({ city, work, sources, onFit, preferredStops }) {
      const { params, priorities, chosen } = get();
      // The previous map stays on screen until the new analysis arrives.
      const { analysis, searchedWith } = get();
      set({ ...EMPTY_RESULTS, analysis, searchedWith, busy: "analyze" });
      const features = Object.entries(chosen).map(([id, radius]) => ({
        id,
        radius,
        weight: Math.max(1, importanceOf(priorities, id)),
      }));
      const transitWeight = importanceOf(priorities, TRANSIT_CRITERION);
      let res: AnalysisResult;
      try {
        res = await api.analyze(
          { city, work, features, transitWeight, preferredStops: preferredStops?.slice(0, 5000), ...params },
          onProgress,
        );
      } catch (e) {
        set({ error: (e as Error).message, busy: null });
        return;
      }
      // Only regions at the chosen level (or better) enter the listing search.
      const eligible = res.regions.filter((r) => atLeast(r.level, get().minLevel));
      const top = eligible.slice(0, TOP_REGIONS);
      const more = eligible.slice(TOP_REGIONS, MAX_REGIONS);
      set({ analysis: res, selectedRegions: new Set(top.map((r) => r.id)) });
      const n = (l: RegionLevel) => res.regions.filter((r) => r.level === l).length;
      say(msg.regionsFound(n("excellent"), n("good"), n("ok"), top.length));
      if (res.cells.length) {
        const lats = res.cells.map((c) => c.lat);
        const lngs = res.cells.map((c) => c.lng);
        onFit({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) });
      }
      if (top.length && sources.length) await get().runListings(city, top, sources, get().filters, more);
      else set({ busy: null });
    },
  };
});

persistFields(useSearchStore, {
  chosen: "features",
  params: "params",
  priorities: "priorities",
  minLevel: "minLevel",
  filters: "filters",
  disabledSources: "disabledSources",
  extraAgencies: "extraAgencies",
  maxPerRegion: "maxPerRegion",
});
