import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BBox, BusLine, Cell, City, FeatureDef, LatLng, LinkResult, Listing, PlaceResult, TransitOperatorInfo } from "../shared/types";
import { api } from "./api";
import { FilterBar } from "./components/FilterBar";
import { LinksPanel } from "./components/LinksPanel";
import { LinePopover } from "./components/LinePopover";
import { MapSettingsPanel } from "./components/MapSettingsPanel";
import { TimetableModal } from "./components/TimetableModal";
import { ListingDetail } from "./components/ListingDetail";
import { PreviewCard } from "./components/PreviewCard";
import { ResultsPanel } from "./components/ResultsPanel";
import { SetupWizard } from "./components/SetupWizard";
import { TopBar, type Mode } from "./components/TopBar";
import { distM, makeCellLookup, meters, walkMin } from "./format";
import { FEATURE_ICON, Icon } from "./icons";
import { summarizeLines } from "./lines";
import { MapView, type LineHover, type NumberedListing } from "./MapView";
import { greatThreshold, normalizeMapSettings, type MapSettings } from "./mapSettings";
import { DEFAULT_FILTERS, matchScore, missesOf, normalizeFilters, sortRanked, visibleListings, wideFilters, type Filters, type NearWant, type Ranked } from "./search";
import { usePersistent } from "./usePersistent";
import { useSearch } from "./useSearch";

export function App() {
  const [mode, setMode] = usePersistent<Mode>("mode", "explore");
  const [city, setCity] = usePersistent<City | null>("city", null);
  const [work, setWork] = usePersistent<(LatLng & { label?: string }) | null>("work", null);
  const [rawFilters, setFilters] = usePersistent<Filters>("filters", DEFAULT_FILTERS);
  const filters = useMemo(() => normalizeFilters(rawFilters), [rawFilters]);
  const [setupOpen, setSetupOpen] = useState(() => !(city && work));
  const [setupStep, setSetupStep] = useState(0);
  const [pickingWork, setPickingWork] = useState(false);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [rawMapSettings, setMapSettings] = usePersistent<MapSettings>("mapSettings", normalizeMapSettings(null));
  const mapSettings = useMemo(() => normalizeMapSettings(rawMapSettings), [rawMapSettings]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Linha sob o mouse (popover) e linha com a grade de horários aberta. */
  const [lineHover, setLineHover] = useState<{ key: string; x: number; y: number; pinned: boolean } | null>(null);
  const [timetableKey, setTimetableKey] = useState<string | null>(null);
  // Favoritos: guarda o anúncio inteiro (a busca não fica salva, os favoritos sim).
  const [favMap, setFavMap] = usePersistent<Record<string, Listing>>("favorites", {});
  const [listMode, setListMode] = usePersistent<"all" | "fav">("listMode", "all");
  const isFav = useCallback((id: string) => id in favMap, [favMap]);
  const toggleFav = (l: Listing) =>
    setFavMap((m) => {
      const n = { ...m };
      if (l.id in n) delete n[l.id];
      else n[l.id] = l;
      return n;
    });
  const closeTimer = useRef<number | undefined>(undefined);
  const mapWrap = useRef<HTMLElement>(null);
  const [linkResults, setLinkResults] = usePersistent<LinkResult[]>("links", []);
  const [busLines, setBusLines] = useState<BusLine[]>([]);
  const [busQueries, setBusQueries] = usePersistent<string[]>("busLines", []);
  const [fit, setFit] = useState<{ bbox: BBox; key: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [viewBBox, setViewBBox] = useState<BBox | null>(null);
  const [loadingCity, setLoadingCity] = useState(false);
  const [operator, setOperator] = useState<TransitOperatorInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [regionTab, setRegionTab] = useState("all");
  const search = useSearch();
  // Restauração das linhas salvas: enquanto não termina, não regrava a lista (senão ela vira []).
  const restoringLines = useRef(busQueries.length > 0);
  // Linhas que não voltaram (Overpass fora do ar etc.): continuam salvas para a próxima vez.
  const unrestored = useRef<Set<string>>(new Set());

  const fitTo = (bbox: BBox) => setFit({ bbox, key: Date.now() });

  useEffect(() => {
    api.features().then(setFeatures).catch(() => setFeatures([]));
    if (city) fitTo(city.bbox);
    // Linhas salvas: guarda só o id (OSM ou "emdec:353:1") e busca de novo (o servidor tem cache).
    Promise.allSettled(
      busQueries.map((id) => {
        const q = id.includes(":") ? id : `https://www.openstreetmap.org/relation/${id}`;
        return api.bus(q, undefined, city).then(
          (ls) => {
            if (!ls.length) unrestored.current.add(id);
            setBusLines((prev) => [...prev.filter((x) => x.id !== id), ...ls]);
          },
          () => unrestored.current.add(id),
        );
      }),
    ).then(() => {
      restoringLines.current = false;
      setBusLines((prev) => [...prev]); // regrava agora, com o que voltou + o que falhou
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Quem publica as linhas de ônibus da cidade escolhida (ex.: Campinas → EMDEC) e
  // quais portais e imobiliárias atendem a cidade.
  useEffect(() => {
    setOperator(null);
    if (city) api.operator(city).then(setOperator).catch(() => setOperator(null));
    void search.loadSources(city);
  }, [city?.osmId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (restoringLines.current) return;
    setBusQueries([...new Set([...busLines.map((l) => l.id), ...unrestored.current])]);
  }, [busLines]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Remover/limpar linhas pela interface também tira as que não voltaram. */
  const setLinesFromUi = (v: BusLine[] | ((p: BusLine[]) => BusLine[])) => {
    setBusLines((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      const kept = new Set(next.map((l) => l.id));
      for (const l of prev) if (!kept.has(l.id)) unrestored.current.delete(l.id);
      if (!next.length) unrestored.current.clear();
      return next;
    });
  };

  const lookup = useMemo(() => {
    const a = search.analysis;
    if (!a) return null;
    const exact = makeCellLookup(a.cells, a.cellSizeM);
    // A busca de imóveis vai ~800 m além das regiões: perto de uma área que cabe no tempo,
    // o trajeto é o dela mais a caminhada até lá.
    const wide = makeCellLookup(a.cells, a.cellSizeM, a.cellSizeM * 0.75 + 900);
    return (l: LatLng): Cell | undefined => {
      const c = exact(l);
      if (c) return c;
      const near = wide(l);
      if (!near) return undefined;
      const extra = Math.max(0, distM(l, near) - a.cellSizeM / 2);
      return { ...near, commuteMin: near.commuteMin + walkMin(extra) };
    };
  }, [search.analysis]);
  const maxMin = search.params.maxCommuteMin;
  // O que precisa ficar perto, com o raio pedido (para dizer "mercado a 2,6 km" quando passa).
  const nearWants: NearWant[] = useMemo(
    () => features.filter((d) => d.id in search.chosen).map((d) => ({ id: d.id, label: d.label.split(" / ")[0]!, radius: search.chosen[d.id]! })),
    [features, search.chosen],
  );
  const rank = useCallback(
    (l: Listing): Ranked => {
      const cell = lookup?.(l);
      // Sem análise (só links colados) não dá para julgar trajeto nem o que tem perto.
      const misses = lookup ? missesOf(l, cell, filters, maxMin, nearWants) : [];
      return { l, cell, match: matchScore(l, cell, filters, maxMin), misses };
    },
    [lookup, filters, maxMin, nearWants],
  );
  const ranked = useMemo(() => sortRanked(visibleListings(search.listings, filters).map(rank), filters), [search.listings, filters, rank]);
  const inTab = useMemo(() => (regionTab === "all" ? ranked : ranked.filter((x) => x.l.region === regionTab)), [ranked, regionTab]);
  // Favoritos: o anúncio mais novo da busca (se veio de novo) ou o guardado.
  const favorites = useMemo(() => {
    const live = new Map(search.listings.map((l) => [l.id, l]));
    return sortRanked(Object.values(favMap).map((l) => rank(live.get(l.id) ?? l)), filters);
  }, [favMap, search.listings, rank, filters]);
  const mapListings = useMemo(() => (listMode === "fav" ? favorites : inTab).map((x) => x.l), [listMode, favorites, inTab]);
  const myLinks: NumberedListing[] = useMemo(
    () => linkResults.filter((r) => r.listing).map((r) => ({ ...r.listing!, index: r.index })),
    [linkResults],
  );
  const findItem = (id: string | null): Ranked | null => {
    if (!id) return null;
    const hit = ranked.find((x) => x.l.id === id) ?? favorites.find((x) => x.l.id === id);
    if (hit) return hit;
    const link = myLinks.find((x) => x.id === id);
    return link ? rank(link) : null;
  };
  const selected = findItem(selectedId);
  const detail = findItem(detailId);
  const stale = search.searchedWith !== null && search.searchedWith !== JSON.stringify(wideFilters(filters));

  // A aba de região deixa de existir quando a busca muda.
  useEffect(() => {
    if (regionTab !== "all" && !search.searchedRegions.some((r) => r.name === regionTab)) setRegionTab("all");
  }, [search.searchedRegions, regionTab]);

  const onSelectFromMap = useCallback((l: Listing) => setSelectedId(l.id), []);
  const selectFromList = (id: string) => {
    setSelectedId(id);
    setFocus(null);
    setTimeout(() => setFocus(id), 0);
  };

  function openSetup(step: number) {
    setSetupStep(step);
    setSetupOpen(true);
  }

  async function chooseCity(osmId: string) {
    setLoadingCity(true);
    try {
      const c = await api.city(osmId);
      setCity(c);
      search.reset();
      setSelectedId(null);
      fitTo(c.bbox);
    } finally {
      setLoadingCity(false);
    }
  }

  function chooseWork(pl: PlaceResult) {
    setWork({ lat: pl.lat, lng: pl.lng, label: pl.displayName.split(",").slice(0, 3).join(",") });
    fitTo({ south: pl.lat - 0.02, north: pl.lat + 0.02, west: pl.lng - 0.02, east: pl.lng + 0.02 });
  }

  async function pickWork(p: LatLng) {
    setPickingWork(false);
    setWork({ ...p, label: "Ponto marcado no mapa" });
    const r = await api.reverse(p).catch(() => null);
    if (r) setWork({ ...p, label: r.displayName.split(",").slice(0, 3).join(",") });
  }

  function runAll(override?: { maxCommuteMin: number }) {
    if (!city || !work) return openSetup(0);
    setSetupOpen(false);
    setMode("explore");
    setRegionTab("all");
    setSelectedId(null);
    void search.runAll(city, work, filters, fitTo, override);
  }

  async function addLine(q: string): Promise<string> {
    try {
      const found = await api.bus(q, city?.bbox ?? viewBBox ?? undefined, city);
      if (!found.length) return `Não achei a linha "${q}"${city ? ` em ${city.name}` : ""}.`;
      setLinesFromUi((prev) => [...prev.filter((l) => !found.some((f) => f.id === l.id)), ...found]);
      return `Linha ${found[0]!.ref ?? q} no mapa (${found.length} ${found.length === 1 ? "sentido" : "sentidos"}, ${found.reduce((n, l) => n + l.stops.length, 0)} pontos).`;
    } catch (e) {
      return (e as Error).message;
    }
  }

  const chosenDefs = features.filter((d) => d.id in search.chosen);
  const lineRefs = mapSettings.myLines ? [...new Map(busLines.map((l) => [l.ref ?? l.name, l.color])).entries()].slice(0, 3) : [];
  const greatFrom = useMemo(() => greatThreshold(search.analysis?.cells ?? []), [search.analysis]);
  const lines = useMemo(() => summarizeLines(search.analysis?.routes ?? [], busLines), [search.analysis, busLines]);
  const hoveredLine = lineHover ? lines.find((l) => l.key === lineHover.key) : undefined;
  const timetableLine = timetableKey ? lines.find((l) => l.key === timetableKey) : undefined;

  // O popover fica aberto enquanto o mouse está na linha ou nele (pequena folga para ir de um ao outro).
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setLineHover((h) => (h?.pinned ? h : null)), 350);
  };
  const onLineHover: LineHover = useCallback((key, at, pin) => {
    if (!key || !at) return scheduleClose();
    window.clearTimeout(closeTimer.current);
    setLineHover((h) => {
      // Fixado numa linha: passar o mouse sobre outra não troca o popover.
      if (h?.pinned && !pin && h.key !== key) return h;
      return { key, x: at.x, y: at.y, pinned: !!pin || (!!h?.pinned && h.key === key) };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const legendPois = mapSettings.pois ? chosenDefs.filter((d) => !mapSettings.hiddenPois.includes(d.id)) : [];
  const cellsLegend = { great: ["ótima", "a melhor"], ok: ["ok", "boa"], both: ["ok", "ótima"] }[mapSettings.cellBand];

  return (
    <div className={`app ${pickingWork ? "picking" : ""}`}>
      <TopBar
        city={city}
        workLabel={work?.label}
        params={search.params}
        filters={filters}
        mode={mode}
        setMode={(m) => {
          // A configuração cobre o painel e o mapa: trocar de modo fecha ela, senão nada muda na tela.
          setMode(m);
          setSetupOpen(false);
          setPickingWork(false);
        }}
        linksCount={myLinks.length}
        setupOpen={setupOpen}
        onEdit={openSetup}
      />
      {mode === "explore" && !setupOpen && (
        <FilterBar filters={filters} setFilters={setFilters} features={features} chosen={search.chosen} maxCommuteMin={maxMin} onEdit={openSetup} />
      )}

      <div className="main">
        <aside className="panel">
          {mode === "explore" ? (
            <ResultsPanel
              search={search}
              filters={filters}
              setFilters={setFilters}
              features={features}
              ranked={ranked}
              regionTab={regionTab}
              setRegionTab={setRegionTab}
              selectedId={selectedId}
              onSelect={selectFromList}
              onOpen={setDetailId}
              onFit={fitTo}
              onEdit={openSetup}
              canRun={!!city && !!work}
              onRunAll={() => runAll()}
              onRunListings={(regions) => city && search.runListings(city, regions, filters)}
              onTryLonger={() => runAll({ maxCommuteMin: 60 })}
              stale={stale}
              onApplyFilters={(nf) => {
                setFilters(nf);
                if (city) void search.runListings(city, search.searchedRegions, nf);
              }}
              listMode={listMode}
              setListMode={setListMode}
              favorites={favorites}
              isFav={isFav}
              onToggleFav={toggleFav}
            />
          ) : (
            <div className="links-panel">
              <LinksPanel
                city={city}
                work={work}
                viewBBox={viewBBox}
                results={linkResults}
                setResults={setLinkResults}
                lines={busLines}
                setLines={setLinesFromUi}
                operator={operator}
                onFit={fitTo}
                onFocusListing={selectFromList}
              />
            </div>
          )}
          <p className="credits">
            Dados: © OpenStreetMap{operator ? `, ${operator.name}` : ""} e os sites dos anúncios. Tempos de trajeto são estimativas (até uma baldeação).
          </p>
        </aside>

        <main className="mapwrap" ref={mapWrap}>
          <MapView
            city={city}
            work={work}
            pickingWork={pickingWork}
            onPickWork={pickWork}
            analysis={search.analysis}
            features={features}
            selectedRegions={search.selectedRegions}
            onToggleRegion={(id) => {
              const s = new Set(search.selectedRegions);
              if (s.has(id)) s.delete(id);
              else s.add(id);
              search.setSelectedRegions(s);
            }}
            listings={mode === "explore" ? mapListings : []}
            myLinks={myLinks}
            busLines={busLines}
            focusListing={focus}
            selectedId={selectedId}
            onSelectListing={onSelectFromMap}
            settings={mapSettings}
            onLineHover={onLineHover}
            fit={fit}
            onBoundsChange={setViewBBox}
          />

          {pickingWork && (
            <div className="banner">
              Clique no mapa onde fica o seu trabalho
              <button type="button" className="linkbtn light" onClick={() => setPickingWork(false)}>Cancelar</button>
            </div>
          )}

          {mapSettings.legend && (search.analysis || busLines.length > 0 || work) && !pickingWork && (
            <div className="legend" aria-label="Legenda">
              <b>Legenda</b>
              {work && <span><span className="lg-work"><Icon name="brief" size={11} /></span>Trabalho</span>}
              {search.analysis && mapSettings.cells && (
                <span className="lg-col">
                  <span>Nota da região{mapSettings.cellBand === "great" ? " (só as ótimas)" : mapSettings.cellBand === "ok" ? " (só as ok)" : ""}</span>
                  <span className={`lg-bar ${mapSettings.cellBand}`} />
                  <span className="lg-ends"><span>{cellsLegend[0]}</span><span>{cellsLegend[1]}</span></span>
                </span>
              )}
              {lineRefs.map(([ref, color]) => (
                <span key={ref}><span className="lg-line" style={{ background: color }} />Linha {ref}</span>
              ))}
              {search.analysis && legendPois.map((d) => (
                <span key={d.id}>
                  <span className="lg-poi" style={{ background: d.color }}><Icon name={FEATURE_ICON[d.id] ?? "pin"} size={11} /></span>
                  {d.label.split(" / ")[0]}
                  <span className="muted">até {meters(search.chosen[d.id]!)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="map-tools">
            <button type="button" className="tool" aria-label="Configurar o mapa" title="Configurar o mapa" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
              <Icon name="sliders" size={18} />
            </button>
            {settingsOpen && (
              <MapSettingsPanel
                settings={mapSettings}
                setSettings={setMapSettings}
                features={chosenDefs}
                greatFrom={greatFrom}
                hasAnalysis={!!search.analysis}
                myLinesCount={new Set(busLines.map((l) => l.ref ?? l.id)).size}
                myLinksCount={myLinks.length}
                lines={lines}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>

          {hoveredLine && lineHover && !pickingWork && (
            <LinePopover
              line={hoveredLine}
              x={lineHover.x}
              y={lineHover.y}
              width={mapWrap.current?.clientWidth ?? 800}
              height={mapWrap.current?.clientHeight ?? 600}
              pinned={lineHover.pinned}
              onEnter={() => window.clearTimeout(closeTimer.current)}
              onLeave={scheduleClose}
              onClose={() => setLineHover(null)}
              onHide={() => {
                setMapSettings({ ...mapSettings, hiddenLines: [...new Set([...mapSettings.hiddenLines, hoveredLine.key])] });
                setLineHover(null);
              }}
              onTimetable={() => {
                setTimetableKey(hoveredLine.key);
                setLineHover(null);
              }}
            />
          )}

          {selected && !detail && !pickingWork && (
            <PreviewCard item={selected} filters={filters} busLines={busLines} onOpen={() => setDetailId(selected.l.id)} onClose={() => setSelectedId(null)} fav={isFav(selected.l.id)} onToggleFav={() => toggleFav(selected.l)} />
          )}
        </main>

        {setupOpen && !pickingWork && (
          <div className="setup-overlay">
            <SetupWizard
              step={setupStep}
              setStep={setSetupStep}
              city={city}
              loadingCity={loadingCity}
              operator={operator}
              onChooseCity={chooseCity}
              work={work}
              onWork={chooseWork}
              onPickOnMap={() => setPickingWork(true)}
              features={features}
              search={search}
              filters={filters}
              setFilters={setFilters}
              onAddLine={addLine}
              onFinish={() => runAll()}
              onClose={city && work ? () => setSetupOpen(false) : undefined}
            />
          </div>
        )}
      </div>

      {timetableLine && <TimetableModal line={timetableLine} onClose={() => setTimetableKey(null)} />}

      {detail && (
        <ListingDetail
          item={detail}
          filters={filters}
          maxCommuteMin={maxMin}
          features={features}
          chosen={search.chosen}
          busLines={busLines}
          work={work}
          onClose={() => setDetailId(null)}
          fav={isFav(detail.l.id)}
          onToggleFav={() => toggleFav(detail.l)}
        />
      )}
    </div>
  );
}
