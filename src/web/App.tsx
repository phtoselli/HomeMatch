import { useEffect, useMemo, useState } from "react";
import type { AnalysisResult, BBox, BusLine, City, FeatureDef, LatLng, LinkResult, Listing, TransitOperatorInfo } from "../shared/types";
import { api } from "./api";
import { ExplorePanel, DEFAULT_FILTERS, applyFilters, type Filters } from "./components/ExplorePanel";
import { LinksPanel } from "./components/LinksPanel";
import { SearchBox } from "./components/SearchBox";
import { MapView, type Layers, type NumberedListing } from "./MapView";
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
  const [layers, setLayers] = useState<Layers>({ routes: true, pois: false, cells: true, listings: true });
  const [linkResults, setLinkResults] = usePersistent<LinkResult[]>("links", []);
  const [busLines, setBusLines] = useState<BusLine[]>([]);
  const [busQueries, setBusQueries] = usePersistent<string[]>("busLines", []);
  const [fit, setFit] = useState<{ bbox: BBox; key: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [viewBBox, setViewBBox] = useState<BBox | null>(null);
  const [loadingCity, setLoadingCity] = useState(false);
  const [operator, setOperator] = useState<TransitOperatorInfo | null>(null);

  const fitTo = (bbox: BBox) => setFit({ bbox, key: Date.now() });
  const focusListing = (id: string) => {
    setFocus(null);
    setTimeout(() => setFocus(id), 0);
  };

  useEffect(() => {
    api.features().then(setFeatures).catch(() => setFeatures([]));
    if (city) fitTo(city.bbox);
    // Linhas salvas: guarda só o id (OSM ou "emdec:353:1") e busca de novo (o servidor tem cache).
    for (const id of busQueries) {
      const q = id.includes(":") ? id : `https://www.openstreetmap.org/relation/${id}`;
      api.bus(q, undefined, city).then((ls) => setBusLines((prev) => [...prev.filter((x) => x.id !== id), ...ls])).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Quem publica as linhas de ônibus da cidade escolhida (ex.: Campinas → EMDEC).
  useEffect(() => {
    setOperator(null);
    if (city) api.operator(city).then(setOperator).catch(() => setOperator(null));
  }, [city?.osmId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setBusQueries(busLines.map((l) => l.id)), [busLines]); // eslint-disable-line react-hooks/exhaustive-deps

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
            placeholder="Ex.: Campinas, São Paulo, Curitiba…"
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
            placeholder="Endereço do trabalho"
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
          />
        ) : (
          <LinksPanel
            city={city}
            work={work}
            viewBBox={viewBBox}
            results={linkResults}
            setResults={setLinkResults}
            lines={busLines}
            setLines={setBusLines}
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
    </div>
  );
}
