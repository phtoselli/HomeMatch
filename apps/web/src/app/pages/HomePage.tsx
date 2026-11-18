import { useEffect, useMemo, useRef, useState } from "react";
import { TRANSIT_CRITERION, summarizeLines, wideFilters } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { shortLabel } from "@/shared/lib/format";
import { clearSaved } from "@/shared/lib/persist";
import { useFeatures, useOperator } from "@/shared/api/queries";
import { Icon } from "@/shared/ui";
import { useFavorites } from "@/features/favorites";
import { LinksPanel, useLinks } from "@/features/links";
import { Legend, MapSettingsPanel, MapView, useMapSettings, useMapView } from "@/features/map";
import { ExportPdfButton } from "@/features/report";
import { ListingDetail, PreviewCard, ResultsPanel, useRanked, useRegionTab } from "@/features/results";
import { FilterBar, SetupWizard, mainOf, usePlace, useSearch } from "@/features/search";
import { LinePopover, TimetableModal, useLineHover, useLines } from "@/features/transit";
import { useShell } from "../model/shell";
import { TopBar } from "../organisms/TopBar";
import { MapLayout } from "../templates/MapLayout";

/** The only screen: wires the feature stores into the MapLayout slots. */
export function HomePage() {
  const shell = useShell();
  const { city, work, loadingCity, chooseCity, chooseWork, pickWork } = usePlace();
  const view = useMapView();
  const search = useSearch();
  const { filters, setFilters } = search;
  const features = useFeatures();
  const operator = useOperator(city, work).data ?? null;
  const { settings: mapSettings, setSettings: setMapSettings, hideLine } = useMapSettings();
  const fav = useFavorites();
  const { results: linkResults, setResults: setLinkResults } = useLinks();
  const { lines: busLines, setLines, addLine, restore } = useLines();
  const { ranked, favorites, mapListings, myLinks, find } = useRanked();
  const { tab: regionTab, setTab: setRegionTab } = useRegionTab();
  const hover = useLineHover();
  const [timetableKey, setTimetableKey] = useState<string | null>(null);
  const mapWrap = useRef<HTMLElement>(null);

  // On open: fit the saved city and bring back the lines the user had put on the map.
  useEffect(() => {
    if (city) view.fitTo(city.bbox);
    void restore(city, work);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = find(view.selectedId);
  const detail = find(view.detailId);
  const stale = search.searchedWith !== null && search.searchedWith !== JSON.stringify(wideFilters(filters));
  const isFav = (id: string) => id in fav.favorites;
  const chosenDefs = features.filter((d) => d.id in search.chosen);
  // Main priority (transit or one of the places), for the top bar and the chips.
  const mainId = mainOf(search.priorities, [TRANSIT_CRITERION, ...Object.keys(search.chosen)]);
  const mainFeature = features.find((d) => d.id === mainId);
  const mainLabel = mainId !== TRANSIT_CRITERION && mainFeature ? shortLabel(mainFeature.label) : t.ui.app.transit;
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
    // Stops of the lines the user added: near them, transit counts as met.
    const preferredStops = busLines.flatMap((l) => l.stops.map((p) => [p.lat, p.lng] as [number, number]));
    void search.runAll({ city, work, sources: search.sources, onFit: view.fitTo, preferredStops });
  }

  /** Erases everything the app saved and starts over (asks first: favorites and links cannot be recovered). */
  function resetAll() {
    const ok = window.confirm(t.ui.app.resetConfirm);
    if (!ok) return;
    clearSaved();
    window.location.reload();
  }

  const header = (
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
      exportButton={
        <ExportPdfButton
          city={city}
          work={work}
          filters={filters}
          features={features}
          chosen={search.chosen}
          priorities={search.priorities}
          analysis={search.analysis}
          minLevel={search.minLevel}
          busLines={busLines}
          lines={lines}
        />
      }
    />
  );

  const toolbar = shell.mode === "explore" && !shell.setupOpen && (
    <FilterBar
      filters={filters}
      setFilters={setFilters}
      features={features}
      chosen={search.chosen}
      mainLabel={mainLabel}
      onEdit={shell.openSetup}
    />
  );

  const panel =
    shell.mode === "explore" ? (
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
    );

  const map = (
    <>
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
          {t.ui.app.pickWork}
          <button type="button" className="linkbtn light" onClick={() => view.setPickingWork(false)}>
            {t.ui.common.cancel}
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
          aria-label={t.ui.app.mapSettings}
          title={t.ui.app.mapSettings}
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
    </>
  );

  const overlay = shell.setupOpen && !view.pickingWork && (
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
        onAddLine={(q) => addLine(q, city, city?.bbox ?? view.viewBBox ?? undefined, work)}
        onFinish={() => runAll()}
        onClose={city && work ? shell.closeSetup : undefined}
      />
    </div>
  );

  const dialogs = (
    <>
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
    </>
  );

  return (
    <MapLayout
      picking={view.pickingWork}
      header={header}
      toolbar={toolbar}
      panel={panel}
      credits={t.ui.app.credits(operator?.name)}
      map={map}
      mapRef={mapWrap}
      overlay={overlay}
      dialogs={dialogs}
    />
  );
}
