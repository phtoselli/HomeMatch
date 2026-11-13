import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult, BBox, BusLine, City, FeatureDef, LatLng, LinkResult, Listing, TransitOperatorInfo } from "../shared/types";
import { api } from "./api";
import { ExplorePanel, DEFAULT_FILTERS, applyFilters, type Filters } from "./components/ExplorePanel";
import { LinksPanel } from "./components/LinksPanel";
import { ListingModal } from "./components/ListingModal";
import { SearchBox } from "./components/SearchBox";
import { MapView, type Layers, type NumberedListing } from "./MapView";
import { makeCellLookup } from "./format";
import { usePersistent } from "./usePersistent";

type Mode = "explore" | "links";

export function App() {
  const [mode, setMode] = usePersistent<Mode>("mode", "explore");
  const [city, setCity] = usePersistent<City | null>("city", null);
  const [work, setWork] = usePersistent<(LatLng & { label?: string }) | null>("work", null);
  const [pickingWork, setPickingWork] = useState(false);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<Listing[]>([]);
  const [filters, setFilters] = usePersistent<Filters>("filters", DEFAULT_FILTERS);
  const [layers, setLayers] = useState<Layers>({ routes: true, pois: true, cells: true, listings: true });
  const [linkResults, setLinkResults] = usePersistent<LinkResult[]>("links", []);
  const [busLines, setBusLines] = useState<BusLine[]>([]);
  const [busQueries, setBusQueries] = usePersistent<string[]>("busLines", []);
  const [fit, setFit] = useState<{ bbox: BBox; key: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [viewBBox, setViewBBox] = useState<BBox | null>(null);
  const [loadingCity, setLoadingCity] = useState(false);
  const [operator, setOperator] = useState<TransitOperatorInfo | null>(null);
  const [openListing, setOpenListing] = useState<Listing | null>(null);
  // Restauração das linhas salvas: enquanto não termina, não regrava a lista (senão ela vira []).
  const restoringLines = useRef(busQueries.length > 0);
  // Linhas que não voltaram (Overpass fora do ar etc.): continuam salvas para a próxima vez.
  const unrestored = useRef<Set<string>>(new Set());

  const fitTo = (bbox: BBox) => setFit({ bbox, key: Date.now() });
  const focusListing = (id: string) => {
    setFocus(null);
    setTimeout(() => setFocus(id), 0);
    // Da lista também abre os detalhes.
    const l = listings.find((x) => x.id === id) ?? linkResults.find((r) => r.listing?.id === id)?.listing;
    if (l) setOpenListing(l);
  };
  const cellLookup = useMemo(() => (analysis ? makeCellLookup(analysis.cells, analysis.cellSizeM) : null), [analysis]);

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

  // Quem publica as linhas de ônibus da cidade escolhida (ex.: Campinas → EMDEC).
  useEffect(() => {
    setOperator(null);
    if (city) api.operator(city).then(setOperator).catch(() => setOperator(null));
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

  const filtered = useMemo(() => applyFilters(listings, filters), [listings, filters]);
  const myLinks: NumberedListing[] = useMemo(
    () => linkResults.filter((r) => r.listing).map((r) => ({ ...r.listing!, index: r.index })),
    [linkResults],
  );

  async function chooseCity(osmId: string) {
    setLoadingCity(true);
    try {
      const c = await api.city(osmId);
      setCity(c);
      setAnalysis(null);
      setListings([]);
      fitTo(c.bbox);
    } finally {
      setLoadingCity(false);
    }
  }

  async function pickWork(p: LatLng) {
    setPickingWork(false);
    setWork({ ...p, label: "Ponto marcado no mapa" });
    const r = await api.reverse(p).catch(() => null);
    if (r) setWork({ ...p, label: r.displayName.split(",").slice(0, 3).join(",") });
  }

  return (
    <div className={`app ${pickingWork ? "picking" : ""}`}>
      <aside className="sidebar">
        <header>
          <h1>🏠 HomeMatch</h1>
          <p>Ache a região certa e o imóvel certo, perto do trabalho e do que importa pra você.</p>
        </header>

        <section className="step">
          <h2><span className="num">1</span>Cidade</h2>
          <SearchBox
            placeholder="Cidade (ex.: Campinas) e Enter"
            initial={city ? `${city.name}${city.stateCode ? ` - ${city.stateCode}` : ""}` : ""}
            search={api.cities}
            minChars={2}
            onSelect={(pl) => chooseCity(pl.osmId)}
          />
          {loadingCity && <p className="hint"><span className="spinner small" /> Carregando limites da cidade…</p>}
          {city && !loadingCity && (
            <p className="hint">
              🚌 Linhas de ônibus:{" "}
              {operator ? (
                <>
                  <b>{operator.name}</b> (<a href={operator.site} target="_blank" rel="noopener">site oficial</a>) — {operator.provides}.
                </>
              ) : (
                "sem operador cadastrado; uso as linhas do OpenStreetMap."
              )}
            </p>
          )}
        </section>

        <section className="step">
          <h2><span className="num">2</span>Trabalho</h2>
          <SearchBox
            placeholder="Endereço do trabalho e Enter"
            initial={work?.label ?? ""}
            search={(q) => api.geocode(q, city?.bbox)}
            onSelect={(pl) => {
              setWork({ lat: pl.lat, lng: pl.lng, label: pl.displayName.split(",").slice(0, 3).join(",") });
              fitTo({ south: pl.lat - 0.02, north: pl.lat + 0.02, west: pl.lng - 0.02, east: pl.lng + 0.02 });
            }}
          />
          <button className={`ghost ${pickingWork ? "active" : ""}`} onClick={() => setPickingWork(!pickingWork)}>
            {pickingWork ? "Clique no mapa… (cancelar)" : "📍 Marcar no mapa"}
          </button>
          {work && <p className="hint">💼 {work.label}</p>}
        </section>

        <nav className="tabs">
          <button className={mode === "explore" ? "on" : ""} onClick={() => setMode("explore")}>🔎 Explorar regiões</button>
          <button className={mode === "links" ? "on" : ""} onClick={() => setMode("links")}>
            🔗 Meus links{myLinks.length ? ` (${myLinks.length})` : ""}
          </button>
        </nav>

        {mode === "explore" ? (
          <ExplorePanel
            city={city}
            work={work}
            features={features}
            analysis={analysis}
            setAnalysis={setAnalysis}
            selectedRegions={selectedRegions}
            setSelectedRegions={setSelectedRegions}
            listings={listings}
            setListings={setListings}
            filtered={filtered}
            filters={filters}
            setFilters={setFilters}
            layers={layers}
            setLayers={setLayers}
            onFit={fitTo}
            onFocusListing={focusListing}
            onOpenListing={setOpenListing}
          />
        ) : (
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
            onFocusListing={focusListing}
          />
        )}

        <footer>
          Dados: © OpenStreetMap (Nominatim, Overpass) · anúncios dos próprios sites. Tempos de trajeto são estimativas
          (linhas diretas, sem baldeação).
        </footer>
      </aside>

      <main className="mapwrap">
        <MapView
          city={city}
          work={work}
          pickingWork={pickingWork}
          onPickWork={pickWork}
          analysis={analysis}
          features={features}
          selectedRegions={selectedRegions}
          onToggleRegion={(id) => {
            const s = new Set(selectedRegions);
            if (s.has(id)) s.delete(id);
            else s.add(id);
            setSelectedRegions(s);
          }}
          listings={mode === "explore" ? filtered : []}
          myLinks={myLinks}
          busLines={busLines}
          focusListing={focus}
          onOpenListing={setOpenListing}
          layers={layers}
          fit={fit}
          onBoundsChange={setViewBBox}
        />
        {pickingWork && <div className="banner">Clique no mapa onde fica o seu trabalho</div>}
        {analysis && mode === "explore" && layers.cells && (
          <div className="legend">
            <div>Nota da região</div>
            <div className="bar" />
            <div className="ends"><span>ok</span><span>ótima</span></div>
          </div>
        )}
      </main>
      {openListing && (
        <ListingModal
          listing={openListing}
          cell={cellLookup?.(openListing)}
          work={work}
          busLines={busLines}
          onClose={() => setOpenListing(null)}
        />
      )}
    </div>
  );
}
