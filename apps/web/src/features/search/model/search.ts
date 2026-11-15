import { create } from "zustand";
import type { AnalysisResult, BBox, City, LatLng, Listing, Region, SourceId } from "@homematch/contracts";
import {
  DEFAULT_FILTERS,
  DEFAULT_PARAMS,
  diagnose,
  normalizeFilters,
  wideFilters,
  type Diagnosis,
  type Filters,
  type Params,
} from "@homematch/domain";
import { api } from "@/shared/api/client";
import { persistFields, readSaved } from "@/shared/lib/persist";

/** Quantas das melhores regiões entram na busca de imóveis automática. */
export const TOP_REGIONS = 5;
/** Com menos anúncios que isso, a busca se amplia sozinha para as próximas regiões (até MAX_REGIONS). */
export const ENOUGH_LISTINGS = 25;
export const MAX_REGIONS = 15;

export type Busy = "analyze" | "listings" | null;

export interface RunAllArgs {
  city: City;
  work: LatLng;
  sources: SourceId[];
  onFit: (b: BBox) => void;
  /** Muda um parâmetro antes de buscar (ex.: "tentar com 60 min"). */
  override?: Partial<Params>;
}

interface SearchState {
  // ---- o que a pessoa pede (salvo no navegador) ----
  /** Característica → raio em metros (o que quer perto de casa). */
  chosen: Record<string, number>;
  params: Params;
  filters: Filters;
  /** Fontes desmarcadas: as novas que aparecerem na cidade entram marcadas. */
  disabledSources: SourceId[];
  maxPerRegion: number;
  // ---- o que a busca achou (some ao recarregar) ----
  analysis: AnalysisResult | null;
  listings: Listing[];
  selectedRegions: Set<string>;
  /** Regiões em que os imóveis da lista foram buscados (abas da lista). */
  searchedRegions: Region[];
  busy: Busy;
  log: string[];
  /** Avisos da busca (site que bloqueou, região que falhou): ficam todos, o log só guarda os últimos. */
  warnings: string[];
  error: string | null;
  /** Filtros usados na última busca: se a pessoa afrouxar algum, precisa buscar de novo. */
  searchedWith: string | null;
  /** Quando a busca volta vazia: o que existe logo acima do teto e em outros tipos. */
  diagnosis: Diagnosis | null;

  setChosen: (c: Record<string, number>) => void;
  setParams: (p: Params) => void;
  setFilters: (f: Filters) => void;
  setSourceEnabled: (id: SourceId, on: boolean) => void;
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
  /** Uma linha no andamento; "Aviso: …" também entra nos avisos (um por fonte). */
  const say = (m: string) =>
    set((s) => {
      const log = [...s.log.slice(-7), m];
      if (!m.startsWith("Aviso: ")) return { log };
      // A busca ampliada roda em lotes e repetiria o mesmo bloqueio: um aviso por fonte ("Aviso: OLX: …").
      const key = (x: string) => x.slice(7).split(":")[0];
      return { log, warnings: s.warnings.some((x) => key(x) === key(m)) ? s.warnings : [...s.warnings, m] };
    });
  const onProgress = (ev: { type: string; message?: string }) => {
    if (ev.type === "progress" || ev.type === "warning") say((ev.type === "warning" ? "Aviso: " : "") + ev.message);
  };

  return {
    chosen: readSaved("features", { atacarejo: 2000, parque: 1500 }),
    params: readSaved("params", DEFAULT_PARAMS),
    filters: normalizeFilters(readSaved<Partial<Filters>>("filters", DEFAULT_FILTERS)),
    disabledSources: readSaved<SourceId[]>("disabledSources", []),
    maxPerRegion: readSaved("maxPerRegion", 100),
    ...EMPTY_RESULTS,
    selectedRegions: new Set(),
    busy: null,

    setChosen: (chosen) => set({ chosen }),
    setParams: (params) => set({ params }),
    setFilters: (filters) => set({ filters: normalizeFilters(filters) }),
    setSourceEnabled: (id, on) =>
      set(({ disabledSources: d }) => ({ disabledSources: on ? d.filter((x) => x !== id) : [...new Set([...d, id])] })),
    setMaxPerRegion: (maxPerRegion) => set({ maxPerRegion }),
    setSelectedRegions: (selectedRegions) => set({ selectedRegions }),
    reset: () => set(EMPTY_RESULTS),

    /**
     * Busca os anúncios nas regiões dadas. Se vierem poucos, continua sozinha pelas próximas regiões da lista
     * `more` (em lotes de TOP_REGIONS), para a pessoa não ter que ajustar nada para ver opções.
     */
    async runListings(city, regions, sources, filters = get().filters, more = []) {
      if (!regions.length) return;
      set({ busy: "listings", error: null, listings: [], diagnosis: null, searchedRegions: regions });
      // A busca nos sites é mais larga que o pedido; o que passa aparece como "quase lá".
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
          say(
            `Só ${ids.size} ${ids.size === 1 ? "anúncio" : "anúncios"} até agora. ` +
              `Ampliando a busca para mais ${next.length} ${next.length === 1 ? "região" : "regiões"}…`,
          );
          searched = [...searched, ...next];
          set({ searchedRegions: searched, selectedRegions: new Set(searched.map((r) => r.id)) });
          for (const l of await fetchIn(next)) ids.add(l.id);
        }
        set({ searchedWith: JSON.stringify(sf) });
        if (!ids.size && sources.length) {
          // Nada com esses filtros: olha o que existe logo acima do teto e em outros tipos,
          // para dizer o porquê e sugerir o ajuste (sem isso a tela só ficava vazia).
          say("Nenhum anúncio com esses filtros. Vendo o que existe por perto do seu orçamento…");
          const probe = (f: typeof sf) =>
            api
              .listings({ city: cityRef, regions, sources, maxPerRegion: 60, filters: f }, () => {})
              .catch(() => [] as Listing[]);
          const ceiling = sf.priceMax;
          const same = await probe({ ...sf, priceMin: null, priceMax: ceiling ? Math.round(ceiling * 1.6) : null });
          const any = await probe({ ...sf, types: [], minBedrooms: 0, minBathrooms: 0, minParking: 0, minArea: 0 });
          set({ diagnosis: diagnose(same, any, filters) });
        }
        say("Busca de imóveis concluída.");
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set({ busy: null });
      }
    },

    /** Acha as regiões e já busca os imóveis nas melhores. */
    async runAll({ city, work, sources, onFit, override }) {
      const params = { ...get().params, ...override };
      // O mapa anterior fica na tela até a nova análise chegar.
      const { analysis, searchedWith } = get();
      set({ ...EMPTY_RESULTS, analysis, searchedWith, params, busy: "analyze" });
      const features = Object.entries(get().chosen).map(([id, radius]) => ({ id, radius }));
      let res: AnalysisResult;
      try {
        res = await api.analyze({ city, work, features, ...params, flex: true }, onProgress);
      } catch (e) {
        set({ error: (e as Error).message, busy: null });
        return;
      }
      const top = res.regions.slice(0, TOP_REGIONS);
      const more = res.regions.slice(TOP_REGIONS, MAX_REGIONS);
      set({ analysis: res, selectedRegions: new Set(top.map((r) => r.id)) });
      const exact = res.regions.filter((r) => !r.misses).length;
      const near = res.regions.length - exact;
      say(
        `${exact} ${exact === 1 ? "região atende" : "regiões atendem"} a tudo${near ? ` e ${near} chegam perto` : ""}.` +
          (top.length ? ` Buscando imóveis nas ${top.length} melhores…` : ""),
      );
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
  filters: "filters",
  disabledSources: "disabledSources",
  maxPerRegion: "maxPerRegion",
});
