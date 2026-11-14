import { useEffect, useRef, useState } from "react";
import type { BBox, FeatureDef, Region } from "../../shared/types";
import { meters, money } from "../format";
import { FEATURE_ICON, Icon } from "../icons";
import { priceOf, slackToReach, tierOf, withBudget, type Filters, type Ranked, type SortKey } from "../search";
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
  /** Troca os filtros e busca os imóveis de novo nas mesmas regiões. */
  onApplyFilters: (f: Filters) => void;
}

/** Tela estreita: sem prévia sobre o mapa, o toque no card já abre o detalhe. */
const narrow = () => window.matchMedia("(max-width: 900px)").matches;

const TIERS = [
  { t: 0, title: "Atendem a tudo", hint: "Preço, quartos, tempo e o que você quer perto." },
  { t: 1, title: "Preço, quartos e tempo ok", hint: "Falta algo de perto ou do imóvel; o card diz o quê." },
  { t: 2, title: "Quase lá", hint: "Preço, quartos ou tempo passa um pouco." },
  { t: 3, title: "Outras opções", hint: "Duas ou mais coisas importantes não batem." },
];

const SORTS: [SortKey, string][] = [["match", "Melhor match"], ["price", "Menor preço"], ["commute", "Menor trajeto"]];

export function ResultsPanel(p: Props) {
  const { search: s, filters: f } = p;
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [showOthers, setShowOthers] = useState(false);

  // Pin clicado no mapa: rola a lista até o card.
  useEffect(() => {
    if (p.selectedId) cardRefs.current.get(p.selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.selectedId]);

  const searched = s.searchedRegions;
  // Só as regiões com anúncio viram aba (com a busca ampliada podem ser até 15).
  const tabs = [{ id: "all", label: "Todas", count: p.ranked.length, min: null as number | null }].concat(
    searched
      .map((r) => ({ id: r.name, label: r.name, count: p.ranked.filter((x) => x.l.region === r.name).length, min: r.commuteMin }))
      .filter((t) => t.count > 0 || t.id === p.regionTab)
      .sort((a, b) => b.count - a.count),
  );
  const shown = p.regionTab === "all" ? p.ranked : p.ranked.filter((x) => x.l.region === p.regionTab);
  const byTier = TIERS.map(({ t }) => shown.filter((x) => tierOf(x.misses) === t));
  const [ideal, good, almost, others] = byTier.map((l) => l.length) as [number, number, number, number];
  // Se não há nada melhor, as outras opções já aparecem abertas (é o que existe).
  const othersOpen = showOthers || ideal + good + almost === 0;
  const lastMsg = s.log[s.log.length - 1];
  const warnings = s.log.filter((m) => m.startsWith("Aviso"));
  const a = s.analysis;
  const selectedRegions = a?.regions.filter((r) => s.selectedRegions.has(r.id)) ?? [];

  function renderCard({ l, cell, match, misses }: Ranked) {
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
            {over != null && !misses.some((m) => m.kind === "price") && <b className="over"> · +{money(over)} do alvo</b>}
          </span>
          <span className="lcard-title">{specsLine(l)}</span>
          <span className="lcard-sub">{l.region ?? l.neighbourhood ?? l.address}</span>
          {misses.length > 0 && (
            <span className="lcard-chips" aria-label="O que não bate com o pedido">
              {misses.map((m) => (
                <span key={m.kind + m.label} className="chip-mini miss"><Icon name="alert" size={12} /> {m.label}</span>
              ))}
            </span>
          )}
          <span className="lcard-chips">
            <CommuteChip cell={cell} />
            <AmenityChips l={l} f={f} />
          </span>
        </span>
      </button>
    );
  }

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
            <p className="sub">Responda o básico (onde trabalha, quanto quer pagar e quantos quartos) e a gente mostra o que cabe e o que chega perto.</p>
            {p.canRun ? (
              <button type="button" className="btn primary big" onClick={p.onRunAll}>Mostrar imóveis <Icon name="chevR" /></button>
            ) : (
              <button type="button" className="btn primary big" onClick={() => p.onEdit(0)}>Configurar a busca <Icon name="chevR" /></button>
            )}
          </div>
        )}

        {a && (
          <>
            <div>
              <h1 className="title">
                {s.busy === "analyze"
                  ? "Procurando regiões…"
                  : a.regions.length === 0
                    ? "Nenhuma região coube"
                    : p.ranked.length === 0
                      ? s.busy ? "Buscando imóveis…" : "Nenhum imóvel ainda"
                      : ideal
                        ? `${ideal} ${ideal === 1 ? "imóvel atende" : "imóveis atendem"} a tudo`
                        : good
                          ? `${good} ${good === 1 ? "imóvel cabe" : "imóveis cabem"} no preço, quartos e tempo`
                          : almost
                            ? `${almost} ${almost === 1 ? "imóvel chega" : "imóveis chegam"} perto`
                            : `${others} ${others === 1 ? "opção" : "opções"} perto do que você pediu`}
              </h1>
              {a.regions.length > 0 && p.ranked.length > 0 && (
                <p className="sub">
                  {[ideal && good ? `+${good} com o essencial ok` : "", (ideal || good) && almost ? `+${almost} quase lá` : ""].filter(Boolean).map((t) => <b key={t}>{t} · </b>)}
                  em {searched.length || selectedRegions.length} {searched.length === 1 ? "região" : "regiões"} perto do trabalho.
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
            <span>
              {p.ranked.length === 0 && f.hideUnknown
                ? `Os ${s.listings.length} anúncios encontrados não dizem se têm ${(f.amenities ?? []).length > 1 ? "os itens pedidos" : "o item pedido"} e ficaram escondidos. Muitos anúncios simplesmente não descrevem isso.`
                : `Nenhum anúncio com esses filtros ${p.regionTab === "all" ? "nas regiões buscadas" : `em ${p.regionTab}`}.`}
            </span>
            <div className="row">
              {f.hideUnknown && (
                <button type="button" className="btn primary" onClick={() => p.setFilters({ ...f, hideUnknown: false })}>Mostrar os que não informam</button>
              )}
              <button type="button" className="btn" onClick={() => p.onEdit(3)}>Mudar filtros</button>
            </div>
          </div>
        )}
        {a && a.regions.length > 0 && !s.busy && !s.sources.length && (
          <div className="alert">
            Nenhum site marcado para buscar anúncios.
            <div className="row"><button type="button" className="btn primary" onClick={() => p.onEdit(3)}>Escolher os sites</button></div>
          </div>
        )}
        {a && a.regions.length > 0 && !s.busy && s.searchedWith !== null && s.listings.length === 0 && s.sources.length > 0 && (
          <div className="alert diag">
            <b>Nenhum anúncio com esses filtros nessas regiões.</b>
            {s.diagnosis ? (
              <>
                <span>
                  {s.diagnosis.cheapestSame != null
                    ? `O ${f.types.length === 1 && f.types[0] === "apartamento" ? "apartamento" : "imóvel"}${f.minBedrooms ? ` de ${f.minBedrooms}+ quartos` : ""} mais barato aqui custa ${money(s.diagnosis.cheapestSame)}${s.diagnosis.ceiling ? `, acima do seu teto de ${money(s.diagnosis.ceiling)}` : ""}${s.diagnosis.sameCount > 1 ? ` (há ${s.diagnosis.sameCount} até ${money(Math.round((s.diagnosis.ceiling ?? 0) * 1.6))})` : ""}.`
                    : s.diagnosis.ceiling
                      ? `Não há ${f.minBedrooms ? `${f.minBedrooms}+ quartos` : "imóvel desse tipo"} nessas regiões nem até ${money(Math.round(s.diagnosis.ceiling * 1.6))}.`
                      : "Os sites não têm anúncios desse tipo nessas regiões."}
                  {s.diagnosis.others > 0 && ` Dentro do teto há ${s.diagnosis.others} de outros tipos ou com menos quartos (a partir de ${money(s.diagnosis.othersCheapest!)}).`}
                </span>
                <div className="row">
                  {s.diagnosis.cheapestSame != null && f.budget && (
                    <button type="button" className="btn primary" onClick={() => p.onApplyFilters(withBudget(f, f.budget!, slackToReach(f.budget!, s.diagnosis!.cheapestSame!)))}>
                      Aceitar até {money(s.diagnosis.cheapestSame)}
                    </button>
                  )}
                  {s.diagnosis.others > 0 && (
                    <button type="button" className="btn" onClick={() => p.onApplyFilters({ ...f, types: [], minBedrooms: 0 })}>
                      Ver os {s.diagnosis.others} de outros tipos
                    </button>
                  )}
                  {s.params.maxCommuteMin < 60 && <button type="button" className="btn" onClick={p.onTryLonger}>Buscar com 60 min</button>}
                </div>
              </>
            ) : (
              <span>Tente aumentar o orçamento ou incluir mais regiões abaixo.</span>
            )}
          </div>
        )}

        {TIERS.map(({ t, title, hint }) => {
          const list = byTier[t]!;
          if (!list.length) return null;
          const collapsed = t === 3 && !othersOpen;
          return (
            <section key={t} className={`tier tier${t}`} aria-label={title}>
              <div className="tier-head">
                <h2 className="h3">{title} <span className="tier-count">{list.length}</span></h2>
                {collapsed ? (
                  <button type="button" className="linkbtn" onClick={() => setShowOthers(true)}>Mostrar</button>
                ) : (
                  <span className="hint">{hint}</span>
                )}
              </div>
              {!collapsed && <div className="cards">{list.slice(0, 120).map(renderCard)}</div>}
              {!collapsed && list.length > 120 && <p className="hint center">Mostrando os 120 primeiros. Ordene por preço ou trajeto para ver outros.</p>}
            </section>
          );
        })}

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
                    <span className="rname">{r.rank}. {r.name}{r.misses ? <span className="rtag">quase</span> : null}</span>
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
