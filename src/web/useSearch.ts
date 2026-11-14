import { useState } from "react";
import type { AnalysisResult, BBox, City, LatLng, Listing, Region, SourceId } from "../shared/types";
import { api } from "./api";
import { DEFAULT_PARAMS, searchFilters, type Filters, type Params } from "./search";
import { usePersistent } from "./usePersistent";

/** Quantas das melhores regiões entram na busca de imóveis automática. */
export const TOP_REGIONS = 5;

export type Busy = "analyze" | "listings" | null;

/** Estado e ações da busca: análise das regiões + imóveis nelas. */
export function useSearch() {
  const [chosen, setChosen] = usePersistent<Record<string, number>>("features", { atacarejo: 2000, parque: 1500 });
  const [params, setParams] = usePersistent<Params>("params", DEFAULT_PARAMS);
  const [sources, setSources] = usePersistent<SourceId[]>("sources", ["quintoandar"]);
  const [maxPerRegion, setMaxPerRegion] = usePersistent("maxPerRegion", 100);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  /** Regiões em que os imóveis da lista foram buscados (abas da lista). */
  const [searchedRegions, setSearchedRegions] = useState<Region[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Filtros usados na última busca: se a pessoa afrouxar algum, precisa buscar de novo. */
  const [searchedWith, setSearchedWith] = useState<string | null>(null);

  const say = (m: string) => setLog((l) => [...l.slice(-7), m]);

  function reset() {
    setAnalysis(null);
    setListings([]);
    setSearchedRegions([]);
    setSearchedWith(null);
    setLog([]);
    setError(null);
  }

  async function runListings(city: City, regions: Region[], filters: Filters) {
    if (!regions.length) return;
    setBusy("listings");
    setError(null);
    setListings([]);
    setSearchedRegions(regions);
    const sf = searchFilters(filters);
    try {
      await api.listings(
        { city: { name: city.name, stateCode: city.stateCode, bbox: city.bbox }, regions, sources, maxPerRegion, filters: sf },
        (ev) => {
          if (ev.type === "partial") setListings((prev) => [...prev, ...ev.data]);
          else if (ev.type === "progress" || ev.type === "warning") say((ev.type === "warning" ? "Aviso: " : "") + ev.message);
        },
      );
      setSearchedWith(JSON.stringify(sf));
      say("Busca de imóveis concluída.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Acha as regiões e já busca os imóveis nas melhores. */
  async function runAll(city: City, work: LatLng, filters: Filters, onFit: (b: BBox) => void, override?: Partial<Params>) {
    const prm = { ...params, ...override };
    if (override) setParams(prm);
    setBusy("analyze");
    setError(null);
    setLog([]);
    setListings([]);
    setSearchedRegions([]);
    let res: AnalysisResult;
    try {
      res = await api.analyze(
        { city, work, features: Object.entries(chosen).map(([id, radius]) => ({ id, radius })), ...prm },
        (ev) => (ev.type === "progress" || ev.type === "warning") && say((ev.type === "warning" ? "Aviso: " : "") + ev.message),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      return;
    }
    setAnalysis(res);
    const top = res.regions.slice(0, TOP_REGIONS);
    setSelectedRegions(new Set(top.map((r) => r.id)));
    say(`${res.regions.length} regiões atendem a tudo.${top.length ? ` Buscando imóveis nas ${top.length} melhores…` : ""}`);
    if (res.cells.length) {
      const lats = res.cells.map((c) => c.lat);
      const lngs = res.cells.map((c) => c.lng);
      onFit({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) });
    }
    if (top.length && sources.length) await runListings(city, top, filters);
    else setBusy(null);
  }

  return {
    chosen, setChosen, params, setParams, sources, setSources, maxPerRegion, setMaxPerRegion,
    analysis, listings, selectedRegions, setSelectedRegions, searchedRegions,
    busy, log, error, searchedWith, reset, runAll, runListings,
  };
}

export type Search = ReturnType<typeof useSearch>;
