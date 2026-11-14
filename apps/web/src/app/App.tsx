import { useEffect, useMemo, useRef, useState } from "react";
import { greatThreshold, summarizeLines, wideFilters } from "@homematch/domain";
import { useFeatures, useOperator } from "../shared/api/queries";
import { Icon } from "../shared/ui";
import { useFavorites } from "../features/favorites/store";
import { LinksPanel } from "../features/links/LinksPanel";
import { useLinks } from "../features/links/store";
import { Legend } from "../features/map/Legend";
import { MapSettingsPanel } from "../features/map/MapSettingsPanel";
import { MapView } from "../features/map/MapView";
import { useMapSettings } from "../features/map/settings";
import { useMapView } from "../features/map/viewStore";
import { ListingDetail } from "../features/results/ListingDetail";
import { PreviewCard } from "../features/results/PreviewCard";
import { ResultsPanel } from "../features/results/ResultsPanel";
import { useRanked, useRegionTab } from "../features/results/useRanked";
import { FilterBar } from "../features/search/FilterBar";
import { usePlace } from "../features/search/placeStore";
import { SetupWizard } from "../features/search/SetupWizard";
import { useSearch } from "../features/search/useSearch";
import { LinePopover } from "../features/transit/LinePopover";
import { useLines } from "../features/transit/linesStore";
import { TimetableModal } from "../features/transit/TimetableModal";
import { useLineHover } from "../features/transit/useLineHover";
import { useShell } from "./shellStore";
import { TopBar } from "./TopBar";

/** A tela: barra do topo, painel (busca ou links), mapa e o que abre por cima. O estado mora nos stores. */
export function App() {
  const shell = useShell();
  const { city, work, loadingCity, chooseCity, chooseWork, pickWork } = usePlace();
  const view = useMapView();
  const search = useSearch();
  const { filters, setFilters } = search;
  const features = useFeatures();
  const operator = useOperator(city).data ?? null;
  const { settings: mapSettings, setSettings: setMapSettings, hideLine } = useMapSettings();
  const fav = useFavorites();
  const { results: linkResults, setResults: setLinkResults } = useLinks();
  const { lines: busLines, setLines, addLine, restore } = useLines();
  const { ranked, favorites, mapListings, myLinks, find } = useRanked();
  const { tab: regionTab, setTab: setRegionTab } = useRegionTab();
  const hover = useLineHover();
  const [timetableKey, setTimetableKey] = useState<string | null>(null);
  const mapWrap = useRef<HTMLElement>(null);

  // Ao abrir: enquadra a cidade salva e traz de volta as linhas que a pessoa tinha posto no mapa.
  useEffect(() => {
    if (city) view.fitTo(city.bbox);
    void restore(city);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = find(view.selectedId);
  const detail = find(view.detailId);
  const stale = search.searchedWith !== null && search.searchedWith !== JSON.stringify(wideFilters(filters));
  const isFav = (id: string) => id in fav.favorites;
  const chosenDefs = features.filter((d) => d.id in search.chosen);
  const greatFrom = useMemo(() => greatThreshold(search.analysis?.cells ?? []), [search.analysis]);
  const lines = useMemo(() => summarizeLines(search.analysis?.routes ?? [], busLines), [search.analysis, busLines]);
  const hoveredLine = hover.hover ? lines.find((l) => l.key === hover.hover!.key) : undefined;
  const timetableLine = timetableKey ? lines.find((l) => l.key === timetableKey) : undefined;

  function runAll(override?: { maxCommuteMin: number }) {
    if (!city || !work) return shell.openSetup(0);
    shell.setMode("explore");
    setRegionTab("all");
    view.select(null);
    void search.runAll({ city, work, sources: search.sources, onFit: view.fitTo, override });
  }

  return (
    <div className={`app ${view.pickingWork ? "picking" : ""}`}>
      <TopBar
        city={city}
        workLabel={work?.label}
        params={search.params}
        filters={filters}
        mode={shell.mode}
        setMode={shell.setMode}
        linksCount={myLinks.length}
        setupOpen={shell.setupOpen}
        onEdit={shell.openSetup}
      />
      {shell.mode === "explore" && !shell.setupOpen && (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          features={features}
          chosen={search.chosen}
          maxCommuteMin={search.params.maxCommuteMin}
          onEdit={shell.openSetup}
        />
      )}

      <div className="main">
        <aside className="panel">
          {shell.mode === "explore" ? (
            <ResultsPanel
              search={search}
              filters={filters}
              setFilters={setFilters}
              features={features}
              ranked={ranked}
              regionTab={regionTab}
              setRegionTab={setRegionTab}
              selectedId={view.selectedId}
              onSelect={view.selectAndFocus}
              onOpen={view.openDetail}
              onFit={view.fitTo}
              onEdit={shell.openSetup}
              canRun={!!city && !!work}
              onRunAll={() => runAll()}
              onRunListings={(regions) => city && search.runListings(city, regions, search.sources)}
              onTryLonger={() => runAll({ maxCommuteMin: 60 })}
              stale={stale}
              onApplyFilters={(nf) => {
                setFilters(nf);
                if (city) void search.runListings(city, search.searchedRegions, search.sources, nf);
              }}
              listMode={fav.listMode}
              setListMode={fav.setListMode}
              favorites={favorites}
              isFav={isFav}
              onToggleFav={fav.toggle}
            />
          ) : (
            <div className="links-panel">
              <LinksPanel
                city={city}
                work={work}
                viewBBox={view.viewBBox}
                results={linkResults}
                setResults={setLinkResults}
                lines={busLines}
                setLines={setLines}
                operator={operator}
                onFit={view.fitTo}
                onFocusListing={view.selectAndFocus}
              />
            </div>
          )}
          <p className="credits">
            Dados: © OpenStreetMap{operator ? `, ${operator.name}` : ""} e os sites dos anúncios. Tempos de trajeto são
            estimativas (até uma baldeação).
          </p>
        </aside>

        <main className="mapwrap" ref={mapWrap}>
          <MapView
            city={city}
            work={work}
            pickingWork={view.pickingWork}
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
            listings={shell.mode === "explore" ? mapListings : []}
            myLinks={myLinks}
            busLines={busLines}
            focusListing={view.focusId}
            selectedId={view.selectedId}
            onSelectListing={(l) => view.select(l.id)}
            settings={mapSettings}
            onLineHover={hover.onLineHover}
            fit={view.fit}
            onBoundsChange={view.setViewBBox}
          />

          {view.pickingWork && (
            <div className="banner">
              Clique no mapa onde fica o seu trabalho
              <button type="button" className="linkbtn light" onClick={() => view.setPickingWork(false)}>
                Cancelar
              </button>
            </div>
          )}

          {mapSettings.legend && (search.analysis || busLines.length > 0 || work) && !view.pickingWork && (
            <Legend
              settings={mapSettings}
              hasWork={!!work}
              hasAnalysis={!!search.analysis}
              busLines={busLines}
              features={chosenDefs}
              chosen={search.chosen}
            />
          )}

          <div className="map-tools">
            <button
              type="button"
              className="tool"
              aria-label="Configurar o mapa"
              title="Configurar o mapa"
              aria-expanded={view.settingsOpen}
              onClick={() => view.setSettingsOpen(!view.settingsOpen)}
            >
              <Icon name="sliders" size={18} />
            </button>
            {view.settingsOpen && (
              <MapSettingsPanel
                settings={mapSettings}
                setSettings={setMapSettings}
                features={chosenDefs}
                greatFrom={greatFrom}
                hasAnalysis={!!search.analysis}
                myLinesCount={new Set(busLines.map((l) => l.ref ?? l.id)).size}
                myLinksCount={myLinks.length}
                lines={lines}
                onClose={() => view.setSettingsOpen(false)}
              />
            )}
          </div>

          {hoveredLine && hover.hover && !view.pickingWork && (
            <LinePopover
              line={hoveredLine}
              x={hover.hover.x}
              y={hover.hover.y}
              width={mapWrap.current?.clientWidth ?? 800}
              height={mapWrap.current?.clientHeight ?? 600}
              pinned={hover.hover.pinned}
              onEnter={hover.cancelClose}
              onLeave={hover.scheduleClose}
              onClose={hover.close}
              onHide={() => {
                hideLine(hoveredLine.key);
                hover.close();
              }}
              onTimetable={() => {
                setTimetableKey(hoveredLine.key);
                hover.close();
              }}
            />
          )}

          {selected && !detail && !view.pickingWork && (
            <PreviewCard
              item={selected}
              filters={filters}
              busLines={busLines}
              onOpen={() => view.openDetail(selected.l.id)}
              onClose={() => view.select(null)}
              fav={isFav(selected.l.id)}
              onToggleFav={() => fav.toggle(selected.l)}
            />
          )}
        </main>

        {shell.setupOpen && !view.pickingWork && (
          <div className="setup-overlay">
            <SetupWizard
              step={shell.setupStep}
              setStep={shell.openSetup}
              city={city}
              loadingCity={loadingCity}
              operator={operator}
              onChooseCity={chooseCity}
              work={work}
              onWork={chooseWork}
              onPickOnMap={() => view.setPickingWork(true)}
              features={features}
              search={search}
              filters={filters}
              setFilters={setFilters}
              onAddLine={(q) => addLine(q, city, city?.bbox ?? view.viewBBox ?? undefined)}
              onFinish={() => runAll()}
              onClose={city && work ? shell.closeSetup : undefined}
            />
          </div>
        )}
      </div>

      {timetableLine && <TimetableModal line={timetableLine} onClose={() => setTimetableKey(null)} />}

      {detail && (
        <ListingDetail
          item={detail}
          filters={filters}
          maxCommuteMin={search.params.maxCommuteMin}
          features={features}
          chosen={search.chosen}
          busLines={busLines}
          work={work}
          onClose={() => view.openDetail(null)}
          fav={isFav(detail.l.id)}
          onToggleFav={() => fav.toggle(detail.l)}
        />
      )}
    </div>
  );
}
