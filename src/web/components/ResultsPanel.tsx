import { useEffect, useRef } from "react";
import type { BBox, FeatureDef, Region } from "../../shared/types";
import { meters, money } from "../format";
import { FEATURE_ICON, Icon } from "../icons";
import { priceOf, type Filters, type Ranked, type SortKey } from "../search";
import type { Search } from "../useSearch";
import { AmenityChips, CommuteChip, MatchBadge, breakdown, overBudget, specsLine } from "./ListingBits";
import { Photo } from "./Photo";

interface Props {
  search: Search;
  filters: Filters;
  setFilters: (f: Filters) => void;
  features: FeatureDef[];
  /** Imóveis já filtrados e ordenados (todas as regiões). */
  ranked: Ranked[];
  regionTab: string;
  setRegionTab: (r: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onFit: (b: BBox) => void;
  onEdit: (step: number) => void;
  canRun: boolean;
  onRunAll: () => void;
  onRunListings: (regions: Region[]) => void;
  onTryLonger: () => void;
  stale: boolean;
}

/** Tela estreita: sem prévia sobre o mapa, o toque no card já abre o detalhe. */
const narrow = () => window.matchMedia("(max-width: 900px)").matches;

const SORTS: [SortKey, string][] = [["match", "Melhor match"], ["price", "Menor preço"], ["commute", "Menor trajeto"]];

export function ResultsPanel(p: Props) {
  const { search: s, filters: f } = p;
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());

  // Pin clicado no mapa: rola a lista até o card.
  useEffect(() => {
    if (p.selectedId) cardRefs.current.get(p.selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.selectedId]);

  const searched = s.searchedRegions;
  const tabs = [{ id: "all", label: "Todas", count: p.ranked.length, min: null as number | null }].concat(
    searched.map((r) => ({ id: r.name, label: r.name, count: p.ranked.filter((x) => x.l.region === r.name).length, min: r.commuteMin })),
  );
  const shown = p.regionTab === "all" ? p.ranked : p.ranked.filter((x) => x.l.region === p.regionTab);
  const lastMsg = s.log[s.log.length - 1];
  const warnings = s.log.filter((m) => m.startsWith("Aviso"));
  const a = s.analysis;
  const selectedRegions = a?.regions.filter((r) => s.selectedRegions.has(r.id)) ?? [];

  return (
    <div className="results">
      <div className="results-head">
        {s.busy && (
          <div className="progress" role="status">
            <span className="spinner" />
            <div>
              <b>{s.busy === "analyze" ? "Analisando a cidade…" : "Buscando imóveis…"}</b>
              {lastMsg && <span>{lastMsg}</span>}
              {s.busy === "analyze" && <span className="muted">A primeira análise de uma cidade pode levar alguns minutos. Depois fica em cache.</span>}
            </div>
          </div>
        )}
        {s.error && <div className="alert err"><Icon name="alert" /> {s.error}</div>}

        {!a && !s.busy && (
          <div className="empty">
            <h1 className="title">Vamos achar o seu lugar</h1>
            <p className="sub">Diga onde trabalha, quanto quer gastar e o que precisa ter perto. A gente cruza ônibus, bairros e anúncios.</p>
            {p.canRun ? (
              <button type="button" className="btn primary big" onClick={p.onRunAll}>Encontrar regiões e imóveis <Icon name="chevR" /></button>
            ) : (
              <button type="button" className="btn primary big" onClick={() => p.onEdit(0)}>Configurar a busca <Icon name="chevR" /></button>
            )}
          </div>
        )}

        {a && (
          <>
            <div>
              <h1 className="title">
                {s.busy === "analyze" ? "Procurando regiões…" : a.regions.length === 0 ? "Nenhuma região coube" : `${p.ranked.length} ${p.ranked.length === 1 ? "imóvel combina" : "imóveis combinam"} com você`}
              </h1>
              {a.regions.length > 0 && (
                <p className="sub">
                  Em {searched.length || selectedRegions.length} {searched.length === 1 ? "região" : "regiões"} a até {s.params.maxCommuteMin} min do trabalho
                  {s.listings.length > p.ranked.length ? ` · ${s.listings.length - p.ranked.length} escondidos pelos filtros` : ""}.
                </p>
              )}
            </div>

            {a.regions.length === 0 && !s.busy && (
              <div className="alert">
                <span>
                  Nenhum bairro cabe em {s.params.maxCommuteMin} min com tudo o que você pediu por perto. Aumentar o tempo deixa entrar trajetos com
                  uma baldeação; diminuir os lugares obrigatórios também ajuda.
                </span>
                <div className="row">
                  {s.params.maxCommuteMin < 60 && <button type="button" className="btn primary" onClick={p.onTryLonger}>Tentar com 60 min</button>}
                  <button type="button" className="btn" onClick={() => p.onEdit(2)}>Rever o que precisa perto</button>
                </div>
              </div>
            )}

            {p.stale && !s.busy && (
              <button type="button" className="alert action" onClick={() => p.onRunListings(selectedRegions)}>
                <Icon name="refresh" /> Os filtros mudaram. <b>Buscar de novo</b>
              </button>
            )}

            {searched.length > 1 && (
              <div className="pills" role="group" aria-label="Região">
                {tabs.map((t) => (
                  <button key={t.id} type="button" className="pill" aria-pressed={p.regionTab === t.id} onClick={() => p.setRegionTab(t.id)}>
                    {t.label}
                    {t.min != null && <span className="pill-meta">~{t.min} min</span>}
                    <span className="pill-count">{t.count}</span>
                  </button>
                ))}
              </div>
            )}

            {p.ranked.length > 0 && (
              <div className="row between">
                <span className="hint">Ordenar por</span>
                <div className="seg small" role="group" aria-label="Ordenar">
                  {SORTS.map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={f.sort === k} onClick={() => p.setFilters({ ...f, sort: k })}>{label}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="results-body">
        {a && a.regions.length > 0 && !s.busy && s.listings.length > 0 && shown.length === 0 && (
          <div className="alert">
            Nenhum anúncio com esses filtros {p.regionTab === "all" ? "nas regiões buscadas" : `em ${p.regionTab}`}.
            <div className="row">
              <button type="button" className="btn" onClick={() => p.onEdit(1)}>Mudar orçamento</button>
              <button type="button" className="btn" onClick={() => p.onEdit(3)}>Mudar filtros</button>
            </div>
          </div>
        )}
        {a && a.regions.length > 0 && !s.busy && s.searchedWith !== null && s.listings.length === 0 && (
          <div className="alert">
            Os sites não trouxeram anúncios com esses filtros nessas regiões. Tente aumentar o orçamento ou incluir mais regiões abaixo.
          </div>
        )}

        <div className="cards">
          {shown.slice(0, 200).map(({ l, cell, match }) => {
            const over = overBudget(l, f);
            const price = priceOf(l, f.basis);
            return (
              <button
                key={l.id}
                ref={(el) => { if (el) cardRefs.current.set(l.id, el); else cardRefs.current.delete(l.id); }}
                type="button"
                className="lcard"
                aria-pressed={p.selectedId === l.id}
                onClick={() => (p.selectedId === l.id || narrow() ? p.onOpen(l.id) : p.onSelect(l.id))}
                onDoubleClick={() => p.onOpen(l.id)}
              >
                <Photo className="lcard-photo" src={l.image} />
                <span className="lcard-body">
                  <span className="lcard-top">
                    <span className="price">{price ? money(price) : "Sem preço"}<small> /mês</small></span>
                    <MatchBadge value={match} />
                  </span>
                  <span className="lcard-sub">
                    {breakdown(l)}
                    {over != null && <b className="over"> · +{money(over)} do alvo</b>}
                  </span>
                  <span className="lcard-title">{specsLine(l)}</span>
                  <span className="lcard-sub">{l.region ?? l.neighbourhood ?? l.address}</span>
                  <span className="lcard-chips">
                    <CommuteChip cell={cell} />
                    <AmenityChips l={l} f={f} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {shown.length > 200 && <p className="hint center">Mostrando os 200 primeiros. Use os filtros ou as regiões para afunilar.</p>}

        {a && a.regions.length > 0 && (
          <details className="regions-box">
            <summary>
              <span>Regiões encontradas</span>
              <span className="muted">{a.regions.length} no total · {selectedRegions.length} na busca de imóveis</span>
            </summary>
            <p className="hint">
              {a.stats.cellsMatching} de {a.stats.cellsReachable} áreas alcançáveis têm tudo o que você pediu. Marque as regiões e busque de novo.
            </p>
            <ol className="regions">
              {a.regions.slice(0, 30).map((r) => (
                <li key={r.id} data-on={s.selectedRegions.has(r.id) || undefined}>
                  <input
                    type="checkbox"
                    aria-label={`Incluir ${r.name} na busca`}
                    checked={s.selectedRegions.has(r.id)}
                    onChange={() => {
                      const n = new Set(s.selectedRegions);
                      if (n.has(r.id)) n.delete(r.id);
                      else n.add(r.id);
                      s.setSelectedRegions(n);
                    }}
                  />
                  <button type="button" className="region-btn" onClick={() => p.onFit(r.bbox)}>
                    <span className="rname">{r.rank}. {r.name}</span>
                    <span className="rmeta">
                      <Icon name="bus" size={12} /> {r.commuteMin}–{r.commuteAvg} min
                      {Object.entries(r.featureDist).map(([k, d]) => (
                        <span key={k} className="rfeat" title={p.features.find((x) => x.id === k)?.label}>
                          <Icon name={FEATURE_ICON[k] ?? "pin"} size={12} /> {meters(d)}
                        </span>
                      ))}
                    </span>
                  </button>
                  <span className="score" title="Nota da região">{r.score.toFixed(0)}</span>
                </li>
              ))}
            </ol>
            <button type="button" className={`btn ${p.stale ? "primary" : ""}`} disabled={s.busy !== null || !selectedRegions.length || !s.sources.length} onClick={() => p.onRunListings(selectedRegions)}>
              <Icon name="refresh" /> Buscar imóveis em {selectedRegions.length} {selectedRegions.length === 1 ? "região" : "regiões"}
            </button>
          </details>
        )}

        {warnings.length > 0 && (
          <details className="warnings">
            <summary>{warnings.length} {warnings.length === 1 ? "aviso" : "avisos"} da busca</summary>
            <ul>{warnings.map((w, i) => <li key={i}>{w.replace(/^Aviso: /, "")}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}
