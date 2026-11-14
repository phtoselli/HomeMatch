import { useState } from "react";
import type { AnalysisResult, BBox, City, LatLng, Listing, Region, SourceId, SourcesResult } from "../shared/types";
import { api } from "./api";
import { DEFAULT_PARAMS, diagnose, wideFilters, type Diagnosis, type Filters, type Params } from "./search";
import { usePersistent } from "./usePersistent";

/** Quantas das melhores regiões entram na busca de imóveis automática. */
export const TOP_REGIONS = 5;
/** Com menos anúncios que isso, a busca se amplia sozinha para as próximas regiões (até MAX_REGIONS). */
export const ENOUGH_LISTINGS = 25;
export const MAX_REGIONS = 15;

export type Busy = "analyze" | "listings" | null;

/** Antes de saber o que a cidade tem (ou se a descoberta falhar): os portais. */
const FALLBACK_SOURCES = ["quintoandar", "chavesnamao", "zapimoveis", "vivareal", "lopes", "olx"];

/** Estado e ações da busca: análise das regiões + imóveis nelas. */
export function useSearch() {
  const [chosen, setChosen] = usePersistent<Record<string, number>>("features", { atacarejo: 2000, parque: 1500 });
  const [params, setParams] = usePersistent<Params>("params", DEFAULT_PARAMS);
  // Fontes: todas as que dá para ler na cidade, menos as que a pessoa desmarcou (novas entram marcadas).
  const [disabledSources, setDisabledSources] = usePersistent<SourceId[]>("disabledSources", []);
  const [available, setAvailable] = useState<SourcesResult | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const readable = available ? [...available.portals, ...available.agencies].filter((x) => x.status === "ok") : null;
  const sources: SourceId[] = (readable?.map((x) => x.id) ?? FALLBACK_SOURCES).filter((id) => !disabledSources.includes(id));
  const setSourceEnabled = (id: SourceId, on: boolean) =>
    setDisabledSources((d) => (on ? d.filter((x) => x !== id) : [...new Set([...d, id])]));

  /** Portais + imobiliárias da cidade (descoberta no servidor, com cache). */
  async function loadSources(city: City | null) {
    setLoadingSources(true);
    try {
      setAvailable(await api.sources(city));
    } catch {
      setAvailable(null); // segue com os portais padrão
    } finally {
      setLoadingSources(false);
    }
  }
  const [maxPerRegion, setMaxPerRegion] = usePersistent("maxPerRegion", 100);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  /** Regiões em que os imóveis da lista foram buscados (abas da lista). */
  const [searchedRegions, setSearchedRegions] = useState<Region[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<string[]>([]);
  /** Avisos da busca (site que bloqueou, região que falhou): ficam todos, o log só guarda os últimos. */
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Filtros usados na última busca: se a pessoa afrouxar algum, precisa buscar de novo. */
  const [searchedWith, setSearchedWith] = useState<string | null>(null);
  /** Quando a busca volta vazia: o que existe logo acima do teto e em outros tipos. */
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);

  const say = (m: string) => {
    setLog((l) => [...l.slice(-7), m]);
    // Um aviso por fonte ("Aviso: OLX: …"): a busca ampliada roda em lotes e repetiria o mesmo bloqueio.
    const key = (x: string) => x.slice(7).split(":")[0];
    if (m.startsWith("Aviso: ")) setWarnings((w) => (w.some((x) => key(x) === key(m)) ? w : [...w, m]));
  };

  function reset() {
    setAnalysis(null);
    setListings([]);
    setSearchedRegions([]);
    setSearchedWith(null);
    setDiagnosis(null);
    setLog([]);
    setWarnings([]);
    setError(null);
  }

  /**
   * Busca os anúncios nas regiões dadas. Se vierem poucos, continua sozinha pelas próximas regiões da lista
   * `more` (em lotes de TOP_REGIONS), para a pessoa não ter que ajustar nada para ver opções.
   */
  async function runListings(city: City, regions: Region[], filters: Filters, more: Region[] = []) {
    if (!regions.length) return;
    setBusy("listings");
    setError(null);
    setListings([]);
    setDiagnosis(null);
    setSearchedRegions(regions);
    // A busca nos sites é mais larga que o pedido; o que passa aparece como "quase lá".
    const sf = wideFilters(filters);
    const cityRef = { name: city.name, stateCode: city.stateCode, bbox: city.bbox };
    const fetchIn = (rs: Region[]) =>
      api.listings({ city: cityRef, regions: rs, sources, maxPerRegion, filters: sf }, (ev) => {
        if (ev.type === "partial")
          setListings((prev) => {
            const have = new Set(prev.map((x) => x.id));
            return [...prev, ...ev.data.filter((x) => !have.has(x.id))];
          });
        else if (ev.type === "progress" || ev.type === "warning") say((ev.type === "warning" ? "Aviso: " : "") + ev.message);
      });
    try {
      const ids = new Set((await fetchIn(regions)).map((l) => l.id));
      let searched = regions;
      let rest = more.filter((r) => !regions.some((x) => x.id === r.id));
      while (ids.size < ENOUGH_LISTINGS && rest.length && searched.length < MAX_REGIONS) {
        const next = rest.slice(0, Math.min(TOP_REGIONS, MAX_REGIONS - searched.length));
        rest = rest.slice(next.length);
        say(`Só ${ids.size} ${ids.size === 1 ? "anúncio" : "anúncios"} até agora. Ampliando a busca para mais ${next.length} ${next.length === 1 ? "região" : "regiões"}…`);
        searched = [...searched, ...next];
        setSearchedRegions(searched);
        setSelectedRegions(new Set(searched.map((r) => r.id)));
        for (const l of await fetchIn(next)) ids.add(l.id);
      }
      setSearchedWith(JSON.stringify(sf));
      if (!ids.size && sources.length) {
        // Nada com esses filtros: olha o que existe logo acima do teto e em outros tipos,
        // para dizer o porquê e sugerir o ajuste (sem isso a tela só ficava vazia).
        say("Nenhum anúncio com esses filtros. Vendo o que existe por perto do seu orçamento…");
        const probe = (f: typeof sf) =>
          api.listings({ city: cityRef, regions, sources, maxPerRegion: 60, filters: f }, () => {}).catch(() => [] as Listing[]);
        const ceiling = sf.priceMax;
        const same = await probe({ ...sf, priceMin: null, priceMax: ceiling ? Math.round(ceiling * 1.6) : null });
        const any = await probe({ ...sf, types: [], minBedrooms: 0, minBathrooms: 0, minParking: 0, minArea: 0 });
        setDiagnosis(diagnose(same, any, filters));
      }
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
    setWarnings([]);
    setListings([]);
    setSearchedRegions([]);
    setDiagnosis(null);
    let res: AnalysisResult;
    try {
      res = await api.analyze(
        { city, work, features: Object.entries(chosen).map(([id, radius]) => ({ id, radius })), ...prm, flex: true },
        (ev) => (ev.type === "progress" || ev.type === "warning") && say((ev.type === "warning" ? "Aviso: " : "") + ev.message),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      return;
    }
    setAnalysis(res);
    const top = res.regions.slice(0, TOP_REGIONS);
    const more = res.regions.slice(TOP_REGIONS, MAX_REGIONS);
    setSelectedRegions(new Set(top.map((r) => r.id)));
    const exact = res.regions.filter((r) => !r.misses).length;
    say(`${exact} ${exact === 1 ? "região atende" : "regiões atendem"} a tudo${res.regions.length > exact ? ` e ${res.regions.length - exact} chegam perto` : ""}.${top.length ? ` Buscando imóveis nas ${top.length} melhores…` : ""}`);
    if (res.cells.length) {
      const lats = res.cells.map((c) => c.lat);
      const lngs = res.cells.map((c) => c.lng);
      onFit({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) });
    }
    if (top.length && sources.length) await runListings(city, top, filters, more);
    else setBusy(null);
  }

  return {
    chosen, setChosen, params, setParams, sources, setSourceEnabled, available, loadingSources, loadSources, maxPerRegion, setMaxPerRegion,
    analysis, listings, selectedRegions, setSelectedRegions, searchedRegions,
    busy, log, warnings, error, searchedWith, diagnosis, reset, runAll, runListings,
  };
}

export type Search = ReturnType<typeof useSearch>;
