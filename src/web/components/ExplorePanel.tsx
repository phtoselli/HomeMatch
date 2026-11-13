import { useMemo, useState } from "react";
import { amenityRank, type MapFilters } from "../../shared/filters";
import type { AnalysisResult, BBox, City, FeatureDef, LatLng, Listing, ListingFilters, PropertyType, Region, SourceId } from "../../shared/types";
import { PROPERTY_TYPE_LABEL } from "../../shared/types";
import { api } from "../api";
import { makeCellLookup, meters, money } from "../format";
import type { Layers } from "../MapView";
import { SOURCE_LABEL } from "../MapView";
import { usePersistent } from "../usePersistent";
import { Photo } from "./Photo";

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
  onOpenListing: (l: Listing) => void;
}

/** O que a pessoa procura (vai para a busca nos sites) + ordem e comodidades (só no mapa). */
export interface Filters extends MapFilters {
  sort: "price" | "commute" | "area";
}

export const DEFAULT_FILTERS: Filters = {
  types: [], priceMin: null, priceMax: null, basis: "total", minBedrooms: 0, minBathrooms: 0, minParking: 0, minArea: 0,
  sort: "price", amenities: [], hideUnknown: false,
};

/** Só a parte que os sites entendem (o resto é aplicado no navegador). */
const searchFilters = (f: Filters): ListingFilters => ({
  types: f.types, priceMin: f.priceMin, priceMax: f.priceMax, basis: f.basis,
  minBedrooms: f.minBedrooms, minBathrooms: f.minBathrooms ?? 0, minParking: f.minParking ?? 0, minArea: f.minArea ?? 0,
});

export const AMENITY_FILTERS: { id: string; label: string; tag: string }[] = [
  { id: "armario_cozinha", label: "Armário na cozinha", tag: "🍳 armário cozinha" },
  { id: "armario_quarto", label: "Guarda-roupa no quarto", tag: "🚪 guarda-roupa" },
  { id: "pia", label: "Pia/bancada", tag: "🚰 pia/bancada" },
];
export const AMENITY_TAG: Record<string, string> = {
  ...Object.fromEntries(AMENITY_FILTERS.map((a) => [a.id, a.tag])),
  mobiliado: "🛋️ mobiliado",
};

export { amenityRank, applyFilters, hasAmenity } from "../../shared/filters";

const SEARCH_TYPES: PropertyType[] = ["apartamento", "casa", "casa_condominio", "studio"];
const TOP_REGIONS = 5;

export function ExplorePanel(p: Props) {
  const [chosen, setChosen] = usePersistent<Record<string, number>>("features", { atacarejo: 2000, parque: 1500 });
  const [params, setParams] = usePersistent<Params>("params", {
    maxCommuteMin: 45,
    maxWalkToStopM: 600,
    cellSizeM: 500,
    commuteWeight: 0.7,
  });
  const [sources, setSources] = usePersistent<SourceId[]>("sources", ["quintoandar"]);
  const [maxPerRegion, setMaxPerRegion] = usePersistent("maxPerRegion", 100);
  const [busy, setBusy] = useState<"analyze" | "listings" | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Filtros usados na última busca: se a pessoa afrouxar algum, precisa buscar de novo. */
  const [searchedWith, setSearchedWith] = useState<string | null>(null);

  const say = (m: string) => setLog((l) => [...l.slice(-7), m]);
  const f = p.filters;
  const setF = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });

  async function runListings(regions: Region[]) {
    if (!p.city || !regions.length) return;
    setBusy("listings");
    setError(null);
    p.setListings([]);
    const sf = searchFilters(f);
    try {
      await api.listings(
        { city: { name: p.city.name, stateCode: p.city.stateCode, bbox: p.city.bbox }, regions, sources, maxPerRegion, filters: sf },
        (ev) => {
          if (ev.type === "partial") p.setListings((prev) => [...prev, ...ev.data]);
          else if (ev.type === "progress" || ev.type === "warning") say((ev.type === "warning" ? "⚠️ " : "") + ev.message);
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
  async function runAll() {
    if (!p.city || !p.work) return;
    setBusy("analyze");
    setError(null);
    setLog([]);
    p.setListings([]);
    let res: AnalysisResult;
    try {
      res = await api.analyze(
        {
          city: p.city,
          work: p.work,
          features: Object.entries(chosen).map(([id, radius]) => ({ id, radius })),
          ...params,
        },
        (ev) => (ev.type === "progress" || ev.type === "warning") && say((ev.type === "warning" ? "⚠️ " : "") + ev.message),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      return;
    }
    p.setAnalysis(res);
    const top = res.regions.slice(0, TOP_REGIONS);
    p.setSelectedRegions(new Set(top.map((r) => r.id)));
    say(`${res.regions.length} regiões atendem a tudo.${top.length ? ` Buscando imóveis nas ${top.length} melhores…` : ""}`);
    if (res.cells.length) {
      const lats = res.cells.map((c) => c.lat);
      const lngs = res.cells.map((c) => c.lng);
      p.onFit({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) });
    }
    if (top.length && sources.length) await runListings(top);
    else setBusy(null);
  }

  const lookup = useMemo(() => (p.analysis ? makeCellLookup(p.analysis.cells, p.analysis.cellSizeM) : null), [p.analysis]);
  const sorted = useMemo(() => {
    const withCommute = p.filtered.map((l) => ({ l, c: lookup?.(l) }));
    const key = (x: (typeof withCommute)[number]) =>
      f.sort === "commute" ? x.c?.commuteMin ?? 999 : f.sort === "area" ? -(x.l.area ?? 0) : f.basis === "total" ? x.l.total : x.l.rent;
    // Com comodidades exigidas, quem confirma tudo vem antes de quem não informa.
    const wanted = f.amenities ?? [];
    const rank = (x: (typeof withCommute)[number]) => (wanted.length ? amenityRank(x.l, wanted) : 0);
    return withCommute.sort((a, b) => rank(a) - rank(b) || key(a) - key(b));
  }, [p.filtered, lookup, f.sort, f.basis, f.amenities]);

  const selected = p.analysis?.regions.filter((r) => p.selectedRegions.has(r.id)) ?? [];
  const stale = searchedWith !== null && searchedWith !== JSON.stringify(searchFilters(f));
  const num = (v: number | null | undefined) => (v ? String(v) : "");
  const toNum = (s: string) => (s ? Number(s) : null);

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
          <details>
            <summary>Ajustes da análise</summary>
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
          </details>
        </div>
      </section>

      <section className="step">
        <h2><span className="num">4</span>O imóvel que você procura</h2>
        <div className="filters">
          <div className="chips">
            {SEARCH_TYPES.map((t) => (
              <button key={t} className={`chip ${f.types.includes(t) ? "on" : ""}`} onClick={() => setF({ types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })}>
                {PROPERTY_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="grid2">
            <label>
              Preço
              <select value={f.basis} onChange={(e) => setF({ basis: e.target.value as Filters["basis"] })}>
                <option value="total">total (aluguel + condomínio + IPTU)</option>
                <option value="rent">só o aluguel</option>
              </select>
            </label>
            <label>
              Até (R$)
              <input type="number" inputMode="numeric" min={0} step={100} placeholder="ex.: 2500" value={num(f.priceMax)} onChange={(e) => setF({ priceMax: toNum(e.target.value) })} />
            </label>
            <label>
              Quartos
              <select value={f.minBedrooms} onChange={(e) => setF({ minBedrooms: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n ? `${n} ou mais` : "qualquer"}</option>)}
              </select>
            </label>
            <label>
              Banheiros
              <select value={f.minBathrooms ?? 0} onChange={(e) => setF({ minBathrooms: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n ? `${n} ou mais` : "qualquer"}</option>)}
              </select>
            </label>
            <label>
              Vagas
              <select value={f.minParking ?? 0} onChange={(e) => setF({ minParking: Number(e.target.value) })}>
                {[0, 1, 2].map((n) => <option key={n} value={n}>{n ? `${n} ou mais` : "qualquer"}</option>)}
              </select>
            </label>
            <label>
              Área mínima (m²)
              <input type="number" inputMode="numeric" min={0} step={5} placeholder="qualquer" value={num(f.minArea)} onChange={(e) => setF({ minArea: Number(e.target.value) || 0 })} />
            </label>
          </div>
          <div className="row wrap">
            {AMENITY_FILTERS.map((a) => {
              const on = (f.amenities ?? []).includes(a.id);
              return (
                <label key={a.id} className="chip-check">
                  <input type="checkbox" checked={on} onChange={() => setF({ amenities: on ? (f.amenities ?? []).filter((x) => x !== a.id) : [...(f.amenities ?? []), a.id] })} />
                  {a.label}
                </label>
              );
            })}
          </div>
          {(f.amenities ?? []).length > 0 && (
            <label className="inline" title="Muitos anúncios não descrevem os armários; por padrão eles aparecem no fim da lista.">
              <input type="checkbox" checked={!!f.hideUnknown} onChange={() => setF({ hideUnknown: !f.hideUnknown })} />
              esconder anúncios que não informam
            </label>
          )}
          <div className="row wrap">
            {(["quintoandar", "vivareal"] as SourceId[]).map((s) => (
              <label key={s} className="chip-check">
                <input type="checkbox" checked={sources.includes(s)} onChange={() => setSources(sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s])} />
                {SOURCE_LABEL[s]}
                {s === "vivareal" && <small className="muted" title="O VivaReal costuma bloquear leitura automática (HTTP 403).">(costuma bloquear)</small>}
              </label>
            ))}
            <label className="inline">
              até
              <select value={maxPerRegion} onChange={(e) => setMaxPerRegion(Number(e.target.value))}>
                {[50, 100, 200, 300].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              por região
            </label>
          </div>
        </div>
        <button className="primary" disabled={!p.city || !p.work || busy !== null} onClick={runAll}>
          {busy === "analyze" ? <><span className="spinner" /> Analisando a cidade…</> : busy === "listings" ? <><span className="spinner" /> Buscando imóveis…</> : "🔎 Encontrar regiões e imóveis"}
        </button>
        {!p.city ? <p className="hint">Escolha a cidade primeiro.</p> : !p.work && <p className="hint">Marque o trabalho primeiro.</p>}
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
          <h2><span className="num">5</span>Melhores regiões</h2>
          <p className="hint">
            {p.analysis.regions.length} bairros · {p.analysis.stats.cellsMatching} de {p.analysis.stats.cellsReachable} áreas alcançáveis atendem a tudo ·{" "}
            {p.analysis.routes.length} linhas diretas. Marque ou desmarque regiões e busque de novo.
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
          {p.analysis.regions.length > 0 && (
            <button className={stale ? "primary" : "ghost"} disabled={busy !== null || !selected.length || !sources.length} onClick={() => runListings(selected)}>
              🏠 Buscar imóveis em {selected.length} região(ões){stale ? " com os filtros novos" : " de novo"}
            </button>
          )}
        </section>
      )}

      {(p.listings.length > 0 || searchedWith !== null) && (
        <section className="step">
          <h2><span className="num">6</span>Imóveis para alugar</h2>
          <div className="row">
            <span className="hint grow">
              {p.filtered.length} de {p.listings.length} anúncios{stale ? " · filtros mudaram: busque de novo para ampliar" : ""}
            </span>
            <select value={f.sort} onChange={(e) => setF({ sort: e.target.value as Filters["sort"] })}>
              <option value="price">Mais barato</option>
              <option value="commute">Mais perto do trabalho</option>
              <option value="area">Maior área</option>
            </select>
          </div>
          {!p.listings.length && busy === null && (
            <p className="hint">Nenhum anúncio com esses filtros nas regiões marcadas. Aumente o preço, marque mais regiões ou tire algum filtro.</p>
          )}
          <ul className="listings">
            {sorted.slice(0, 200).map(({ l, c }) => (
              <li
                key={l.id}
                onClick={() => {
                  p.onFocusListing(l.id);
                  p.onOpenListing(l);
                }}
              >
                <Photo className="thumb" src={l.image} />
                <div>
                  <div className="lprice">{money(f.basis === "total" ? l.total : l.rent)}{f.basis === "total" && l.total > l.rent ? <small> total</small> : null}</div>
                  <div className="ltitle">
                    {l.typeLabel}{l.area ? ` · ${l.area} m²` : ""}{l.bedrooms ? ` · ${l.bedrooms} qto` : ""}{l.parking ? ` · ${l.parking} vaga` : ""}
                  </div>
                  <div className="lmeta">{l.region} · {SOURCE_LABEL[l.source]}{c ? ` · 🚌 ~${c.commuteMin} min` : ""}</div>
                  {l.amenities && l.amenities.length > 0 && <div className="lmeta">{l.amenities.map((a) => AMENITY_TAG[a] ?? a).join(" · ")}</div>}
                </div>
                <a href={l.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} title="Abrir anúncio no site">↗</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
