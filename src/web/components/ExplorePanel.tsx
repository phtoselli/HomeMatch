import { useMemo, useState } from "react";
import type { AnalysisResult, BBox, City, FeatureDef, LatLng, Listing, PropertyType, SourceId } from "../../shared/types";
import { PROPERTY_TYPE_LABEL } from "../../shared/types";
import { api } from "../api";
import { makeCellLookup, meters, money } from "../format";
import type { Layers } from "../MapView";
import { SOURCE_LABEL } from "../MapView";
import { usePersistent } from "../usePersistent";

export interface Params {
  maxCommuteMin: number;
  maxWalkToStopM: number;
  cellSizeM: number;
  commuteWeight: number;
}

interface Props {
  city: City | null;
  work: LatLng | null;
  features: FeatureDef[];
  analysis: AnalysisResult | null;
  setAnalysis: (a: AnalysisResult | null) => void;
  selectedRegions: Set<string>;
  setSelectedRegions: (s: Set<string>) => void;
  listings: Listing[];
  setListings: (l: Listing[] | ((p: Listing[]) => Listing[])) => void;
  filtered: Listing[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  layers: Layers;
  setLayers: (l: Layers) => void;
  onFit: (b: BBox) => void;
  onFocusListing: (id: string) => void;
}

export interface Filters {
  types: PropertyType[];
  priceMin: number | null;
  priceMax: number | null;
  basis: "total" | "rent";
  minBedrooms: number;
  sort: "price" | "commute" | "area";
}

export const DEFAULT_FILTERS: Filters = { types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0, sort: "price" };

export function applyFilters(list: Listing[], f: Filters): Listing[] {
  return list.filter((l) => {
    const price = f.basis === "total" ? l.total : l.rent;
    if (f.types.length && !f.types.includes(l.type)) return false;
    if (f.priceMin != null && price < f.priceMin) return false;
    if (f.priceMax != null && price > f.priceMax) return false;
    if (f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms) return false;
    return true;
  });
}

export function ExplorePanel(p: Props) {
  const [chosen, setChosen] = usePersistent<Record<string, number>>("features", { atacarejo: 2000, parque: 1500 });
  const [params, setParams] = usePersistent<Params>("params", {
    maxCommuteMin: 45,
    maxWalkToStopM: 600,
    cellSizeM: 500,
    commuteWeight: 0.7,
  });
  const [sources, setSources] = usePersistent<SourceId[]>("sources", ["quintoandar", "vivareal"]);
  const [maxPerRegion, setMaxPerRegion] = usePersistent("maxPerRegion", 60);
  const [busy, setBusy] = useState<"analyze" | "listings" | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const say = (m: string) => setLog((l) => [...l.slice(-6), m]);

  async function runAnalysis() {
    if (!p.city || !p.work) return;
    setBusy("analyze");
    setError(null);
    setLog([]);
    p.setListings([]);
    try {
      const res = await api.analyze(
        {
          city: p.city,
          work: p.work,
          features: Object.entries(chosen).map(([id, radius]) => ({ id, radius })),
          ...params,
        },
        (ev) => (ev.type === "progress" || ev.type === "warning") && say((ev.type === "warning" ? "⚠️ " : "") + ev.message),
      );
      p.setAnalysis(res);
      p.setSelectedRegions(new Set(res.regions.slice(0, 5).map((r) => r.id)));
      say(`Pronto: ${res.regions.length} regiões atendem a tudo.`);
      if (res.cells.length) {
        const lats = res.cells.map((c) => c.lat);
        const lngs = res.cells.map((c) => c.lng);
        p.onFit({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runListings() {
    if (!p.city || !p.analysis) return;
    const regions = p.analysis.regions.filter((r) => p.selectedRegions.has(r.id));
    setBusy("listings");
    setError(null);
    setLog([]);
    p.setListings([]);
    try {
      await api.listings(
        { city: { name: p.city.name, stateCode: p.city.stateCode, bbox: p.city.bbox }, regions, sources, maxPerRegion },
        (ev) => {
          if (ev.type === "partial") p.setListings((prev) => [...prev, ...ev.data]);
          else if (ev.type === "progress" || ev.type === "warning") say((ev.type === "warning" ? "⚠️ " : "") + ev.message);
        },
      );
      say("Busca de imóveis concluída.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const lookup = useMemo(() => (p.analysis ? makeCellLookup(p.analysis.cells, p.analysis.cellSizeM) : null), [p.analysis]);
  const sorted = useMemo(() => {
    const withCommute = p.filtered.map((l) => ({ l, c: lookup?.(l) }));
    const key = (x: (typeof withCommute)[number]) =>
      p.filters.sort === "commute" ? x.c?.commuteMin ?? 999 : p.filters.sort === "area" ? -(x.l.area ?? 0) : p.filters.basis === "total" ? x.l.total : x.l.rent;
    return withCommute.sort((a, b) => key(a) - key(b));
  }, [p.filtered, lookup, p.filters.sort, p.filters.basis]);

  const f = p.filters;
  const setF = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });

  return (
    <>
      <section className="step">
        <h2><span className="num">3</span>O que você precisa ter perto</h2>
        <div className="features">
          {p.features.map((def) => {
            const on = def.id in chosen;
            return (
              <div key={def.id} className={`feature ${on ? "on" : ""}`}>
                <label title={def.description}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const n = { ...chosen };
                      if (on) delete n[def.id];
                      else n[def.id] = def.defaultRadius;
                      setChosen(n);
                    }}
                  />
                  <span className="emoji">{def.emoji}</span> {def.label}
                </label>
                {on && (
                  <div className="radius">
                    <input
                      type="range"
                      min={200}
                      max={5000}
                      step={100}
                      value={chosen[def.id]}
                      onChange={(e) => setChosen({ ...chosen, [def.id]: Number(e.target.value) })}
                    />
                    <span>até {meters(chosen[def.id]!)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="params">
          <label>
            Tempo máximo até o trabalho: <b>{params.maxCommuteMin} min</b>
            <input type="range" min={15} max={120} step={5} value={params.maxCommuteMin} onChange={(e) => setParams({ ...params, maxCommuteMin: Number(e.target.value) })} />
          </label>
          <label>
            Caminhada até o ponto: <b>{meters(params.maxWalkToStopM)}</b>
            <input type="range" min={200} max={1500} step={50} value={params.maxWalkToStopM} onChange={(e) => setParams({ ...params, maxWalkToStopM: Number(e.target.value) })} />
          </label>
          <label>
            Peso do trajeto na nota: <b>{Math.round(params.commuteWeight * 100)}%</b>
            <input type="range" min={0} max={1} step={0.05} value={params.commuteWeight} onChange={(e) => setParams({ ...params, commuteWeight: Number(e.target.value) })} />
          </label>
          <label>
            Precisão da grade:
            <select value={params.cellSizeM} onChange={(e) => setParams({ ...params, cellSizeM: Number(e.target.value) })}>
              <option value={300}>fina (300 m, mais lenta)</option>
              <option value={500}>normal (500 m)</option>
              <option value={800}>grossa (800 m, cidades grandes)</option>
            </select>
          </label>
        </div>
        <button className="primary" disabled={!p.city || !p.work || busy !== null} onClick={runAnalysis}>
          {busy === "analyze" ? <><span className="spinner" /> Analisando…</> : "🔎 Analisar a cidade"}
        </button>
        {!p.work && <p className="hint">Marque o trabalho primeiro.</p>}
        {busy === "analyze" && <p className="hint">A primeira análise de uma cidade baixa dados do OpenStreetMap e pode levar alguns minutos. Depois fica em cache.</p>}
      </section>

      {(log.length > 0 || error) && (
        <div className="log">
          {log.map((m, i) => <div key={i}>{m}</div>)}
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {p.analysis && (
        <section className="step">
          <h2><span className="num">4</span>Melhores regiões</h2>
          <p className="hint">
            {p.analysis.regions.length} bairros · {p.analysis.stats.cellsMatching} de {p.analysis.stats.cellsReachable} áreas alcançáveis atendem a tudo ·{" "}
            {p.analysis.routes.length} linhas diretas. Marque as regiões para buscar imóveis.
          </p>
          <div className="layers">
            {(["cells", "routes", "pois", "listings"] as const).map((k) => (
              <label key={k}>
                <input type="checkbox" checked={p.layers[k]} onChange={() => p.setLayers({ ...p.layers, [k]: !p.layers[k] })} />
                {{ cells: "Mapa de calor", routes: "Linhas", pois: "Lugares", listings: "Imóveis" }[k]}
              </label>
            ))}
          </div>
          <ol className="regions">
            {p.analysis.regions.slice(0, 30).map((r) => (
              <li key={r.id} className={p.selectedRegions.has(r.id) ? "on" : ""}>
                <input
                  type="checkbox"
                  checked={p.selectedRegions.has(r.id)}
                  onChange={() => {
                    const s = new Set(p.selectedRegions);
                    if (s.has(r.id)) s.delete(r.id);
                    else s.add(r.id);
                    p.setSelectedRegions(s);
                  }}
                />
                <button className="link" onClick={() => p.onFit(r.bbox)}>
                  <span className="rank">{r.rank}</span>
                  <span className="rname">{r.name}</span>
                  <span className="rmeta">
                    🚌 {r.commuteMin}–{r.commuteAvg} min · {r.via.slice(0, 2).join(", ")}
                    {Object.entries(r.featureDist).length > 0 && (
                      <> · {Object.entries(r.featureDist).map(([k, d]) => `${p.features.find((x) => x.id === k)?.emoji ?? ""}${meters(d)}`).join(" ")}</>
                    )}
                  </span>
                </button>
                <span className="score">{r.score.toFixed(0)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.analysis && p.analysis.regions.length > 0 && (
        <section className="step">
          <h2><span className="num">5</span>Imóveis para alugar</h2>
          <div className="row">
            {(["quintoandar", "vivareal"] as SourceId[]).map((s) => (
              <label key={s} className="chip-check">
                <input type="checkbox" checked={sources.includes(s)} onChange={() => setSources(sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s])} />
                {SOURCE_LABEL[s]}
              </label>
            ))}
            <label className="inline">
              até
              <select value={maxPerRegion} onChange={(e) => setMaxPerRegion(Number(e.target.value))}>
                {[30, 60, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              por região
            </label>
          </div>
          <button className="primary" disabled={busy !== null || !p.selectedRegions.size || !sources.length} onClick={runListings}>
            {busy === "listings" ? <><span className="spinner" /> Buscando…</> : `🏠 Buscar imóveis em ${p.selectedRegions.size} região(ões)`}
          </button>

          {p.listings.length > 0 && (
            <>
              <div className="filters">
                <div className="chips">
                  {(Object.keys(PROPERTY_TYPE_LABEL) as PropertyType[]).map((t) => (
                    <button key={t} className={`chip ${f.types.includes(t) ? "on" : ""}`} onClick={() => setF({ types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })}>
                      {PROPERTY_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <select value={f.basis} onChange={(e) => setF({ basis: e.target.value as Filters["basis"] })}>
                    <option value="total">Preço total</option>
                    <option value="rent">Só aluguel</option>
                  </select>
                  <input type="number" placeholder="mín. R$" value={f.priceMin ?? ""} onChange={(e) => setF({ priceMin: e.target.value ? Number(e.target.value) : null })} />
                  <input type="number" placeholder="máx. R$" value={f.priceMax ?? ""} onChange={(e) => setF({ priceMax: e.target.value ? Number(e.target.value) : null })} />
                </div>
                <div className="row">
                  <select value={f.minBedrooms} onChange={(e) => setF({ minBedrooms: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n ? `${n}+ quartos` : "Qualquer nº de quartos"}</option>)}
                  </select>
                  <select value={f.sort} onChange={(e) => setF({ sort: e.target.value as Filters["sort"] })}>
                    <option value="price">Mais barato</option>
                    <option value="commute">Mais perto do trabalho</option>
                    <option value="area">Maior área</option>
                  </select>
                </div>
              </div>
              <p className="hint">{p.filtered.length} de {p.listings.length} anúncios</p>
              <ul className="listings">
                {sorted.slice(0, 200).map(({ l, c }) => (
                  <li key={l.id} onClick={() => p.onFocusListing(l.id)}>
                    {l.image ? <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="noimg">🏠</div>}
                    <div>
                      <div className="lprice">{money(f.basis === "total" ? l.total : l.rent)}</div>
                      <div className="ltitle">{l.typeLabel}{l.area ? ` · ${l.area} m²` : ""}{l.bedrooms ? ` · ${l.bedrooms} qto` : ""}</div>
                      <div className="lmeta">{l.region} · {SOURCE_LABEL[l.source]}{c ? ` · 🚌 ~${c.commuteMin} min` : ""}</div>
                    </div>
                    <a href={l.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} title="Abrir anúncio">↗</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
