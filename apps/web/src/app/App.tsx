import { useEffect, useMemo, useRef, useState } from "react";
import { TRANSIT_CRITERION, summarizeLines, wideFilters } from "@homematch/domain";
import { clearSaved } from "@/shared/lib/persist";
import { useFeatures, useOperator } from "@/shared/api/queries";
import { Icon } from "@/shared/ui";
import { useFavorites } from "@/features/favorites";
import { LinksPanel, useLinks } from "@/features/links";
import { Legend, MapSettingsPanel, MapView, useMapSettings, useMapView } from "@/features/map";
import { ListingDetail, PreviewCard, ResultsPanel, useRanked, useRegionTab } from "@/features/results";
import { FilterBar, SetupWizard, mainOf, usePlace, useSearch } from "@/features/search";
import { LinePopover, TimetableModal, useLineHover, useLines } from "@/features/transit";
import { useShell } from "./shell";
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
  // Prioridade principal (transporte ou um dos lugares), para a barra do topo e os chips.
  const mainId = mainOf(search.priorities, [TRANSIT_CRITERION, ...Object.keys(search.chosen)]);
  const mainLabel =
    mainId === TRANSIT_CRITERION
      ? "Transporte"
      : (features.find((d) => d.id === mainId)?.label.split(" / ")[0] ?? "Transporte");
  const commuteRef = search.analysis
    ? { bestMin: search.analysis.stats.commuteBestMin, refMin: search.analysis.stats.commuteRefMin }
    : null;
  const lines = useMemo(() => summarizeLines(search.analysis?.routes ?? [], busLines), [search.analysis, busLines]);
  const hoveredLine = hover.hover ? lines.find((l) => l.key === hover.hover!.key) : undefined;
  const timetableLine = timetableKey ? lines.find((l) => l.key === timetableKey) : undefined;

  function runAll() {
    if (!city || !work) return shell.openSetup(0);
    shell.setMode("explore");
    setRegionTab("all");
    view.select(null);
    // Pontos das linhas que a pessoa adicionou: perto deles, o transporte conta como atingido.
    const preferredStops = busLines.flatMap((l) => l.stops.map((p) => [p.lat, p.lng] as [number, number]));
    void search.runAll({ city, work, sources: search.sources, onFit: view.fitTo, preferredStops });
  }

  /** Apaga tudo o que o app guardou e recomeça do zero (pede confirmação: favoritos e links não voltam). */
  function resetAll() {
    const ok = window.confirm(
      "Resetar tudo? Isso apaga a busca, as prioridades, os favoritos, os links colados e as linhas que você " +
        "adicionou neste navegador, e volta ao padrão inicial. Não dá para desfazer.",
    );
    if (!ok) return;
    clearSaved();
    window.location.reload();
  }

  return (
    <div className={`app ${view.pickingWork ? "picking" : ""}`}>
      <TopBar
        city={city}
        workLabel={work?.label}
        mainLabel={mainLabel}
        filters={filters}
        mode={shell.mode}
        setMode={shell.setMode}
        linksCount={myLinks.length}
        setupOpen={shell.setupOpen}
        onEdit={shell.openSetup}
        onReset={resetAll}
      />
      {shell.mode === "explore" && !shell.setupOpen && (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          features={features}
          chosen={search.chosen}
          mainLabel={mainLabel}
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
            minLevel={search.minLevel}
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
              minLevel={search.minLevel}
              estimatedLeg={!!search.analysis?.routes.some((r) => r.estimated)}
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
                minLevel={search.minLevel}
                setMinLevel={search.setMinLevel}
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
          commuteRef={commuteRef}
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
