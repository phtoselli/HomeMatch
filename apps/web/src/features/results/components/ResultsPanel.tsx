import { useEffect, useRef, useState } from "react";
import type { BBox, FeatureDef, Region, RegionLevel } from "@homematch/contracts";
import {
  LEVEL_LABEL,
  atLeast,
  noTransitNear,
  meters,
  money,
  priceOf,
  slackToReach,
  tierOf,
  withBudget,
  type Filters,
  type Ranked,
  type SortKey,
} from "@homematch/domain";
import { ErrorAlert, FEATURE_ICON, Icon, Photo, Segmented, Spinner } from "@/shared/ui";
import type { Search } from "@/features/search";
import { AmenityChips, breakdown, CommuteChip, MatchBadge, overBudget, specsLine } from "./ListingBits";
import { LEVEL_COLOR, sourceName } from "@/shared/lib/format";

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
  stale: boolean;
  /** Troca os filtros e busca os imóveis de novo nas mesmas regiões. */
  onApplyFilters: (f: Filters) => void;
  /** Todos os imóveis da busca ou só os favoritos. */
  listMode: "all" | "fav";
  setListMode: (m: "all" | "fav") => void;
  /** Favoritos (guardados no navegador), já com nota e o que não bate. */
  favorites: Ranked[];
  isFav: (id: string) => boolean;
  onToggleFav: (l: Ranked["l"]) => void;
}

/** Tela estreita: sem prévia sobre o mapa, o toque no card já abre o detalhe. */
const narrow = () => window.matchMedia("(max-width: 900px)").matches;

const MIN_LEVELS: [RegionLevel, string][] = [
  ["ok", "Todas"],
  ["boa", "Boa ou melhor"],
  ["excelente", "Só excelentes"],
];

const TIERS = [
  { t: 0, title: "Atendem a tudo", hint: "Preço, quartos e o que você quer perto, numa região recomendada." },
  { t: 1, title: "Preço e quartos ok", hint: "Falta algo de perto ou do imóvel; o card diz o quê." },
  { t: 2, title: "Quase lá", hint: "Preço ou quartos passa um pouco." },
  { t: 3, title: "Outras opções", hint: "Duas ou mais coisas importantes não batem." },
];

const SORTS: [SortKey, string][] = [
  ["match", "Melhor match"],
  ["price", "Menor preço"],
  ["commute", "Menor trajeto"],
];

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
      .map((r) => ({
        id: r.name,
        label: r.name,
        count: p.ranked.filter((x) => x.l.region === r.name).length,
        min: r.commuteMin,
      }))
      .filter((t) => t.count > 0 || t.id === p.regionTab)
      .sort((a, b) => b.count - a.count),
  );
  const shown = p.regionTab === "all" ? p.ranked : p.ranked.filter((x) => x.l.region === p.regionTab);
  const byTier = TIERS.map(({ t }) => shown.filter((x) => tierOf(x.misses) === t));
  const [ideal, good, almost, others] = byTier.map((l) => l.length) as [number, number, number, number];
  // Se não há nada melhor, as outras opções já aparecem abertas (é o que existe).
  const othersOpen = showOthers || ideal + good + almost === 0;
  const lastMsg = s.log[s.log.length - 1];
  const warnings = s.warnings;
  const a = s.analysis;
  const selectedRegions = a?.regions.filter((r) => s.selectedRegions.has(r.id)) ?? [];
  // Regiões do nível escolhido (ou melhor).
  const shownRegions = a?.regions.filter((r) => atLeast(r.level, s.minLevel)) ?? [];

  function renderCard({ l, cell, match, misses }: Ranked) {
    const over = overBudget(l, f);
    const price = priceOf(l, f.basis);
    const fav = p.isFav(l.id);
    return (
      <div key={l.id} className="lcard-wrap">
        <button
          ref={(el) => {
            if (el) cardRefs.current.set(l.id, el);
            else cardRefs.current.delete(l.id);
          }}
          type="button"
          className="lcard"
          aria-pressed={p.selectedId === l.id}
          onClick={() => (p.selectedId === l.id || narrow() ? p.onOpen(l.id) : p.onSelect(l.id))}
          onDoubleClick={() => p.onOpen(l.id)}
        >
          <Photo className="lcard-photo" src={l.image} />
          <span className="lcard-body">
            <span className="lcard-top">
              <span className="price">
                {price ? money(price) : "Sem preço"}
                <small> /mês</small>
              </span>
              <MatchBadge value={match} />
            </span>
            <span className="lcard-sub">
              {breakdown(l)}
              {over != null && !misses.some((m) => m.kind === "price") && (
                <b className="over"> · +{money(over)} do alvo</b>
              )}
            </span>
            <span className="lcard-title">{specsLine(l)}</span>
            <span className="lcard-sub">
              {l.region ?? l.neighbourhood ?? l.address} ·{" "}
              <span className="src-inline">
                {sourceName(l, "")}
                {l.agency && l.agency !== sourceName(l) ? ` · ${l.agency}` : ""}
              </span>
            </span>
            {misses.length > 0 && (
              <span className="lcard-chips" aria-label="O que não bate com o pedido">
                {misses.map((m) => (
                  <span key={m.kind + m.label} className="chip-mini miss">
                    <Icon name="alert" size={12} /> {m.label}
                  </span>
                ))}
              </span>
            )}
            <span className="lcard-chips">
              <CommuteChip cell={cell} />
              <AmenityChips l={l} f={f} />
            </span>
          </span>
        </button>
        <button
          type="button"
          className="fav-btn"
          aria-pressed={fav}
          aria-label={fav ? "Tirar dos favoritos" : "Favoritar"}
          title={fav ? "Tirar dos favoritos" : "Favoritar"}
          onClick={() => p.onToggleFav(l)}
        >
          <Icon name="heart" size={18} />
        </button>
      </div>
    );
  }

  const switcher = (a || p.favorites.length > 0) && (
    <Segmented
      className="list-mode"
      label="Mostrar"
      value={p.listMode}
      onChange={p.setListMode}
      options={[
        { value: "all", label: <>Todos{a ? <span className="seg-count">{p.ranked.length}</span> : null}</> },
        {
          value: "fav",
          label: (
            <>
              <Icon name="heart" size={14} /> Favoritos<span className="seg-count">{p.favorites.length}</span>
            </>
          ),
        },
      ]}
    />
  );

  if (p.listMode === "fav") {
    return (
      <div className="results">
        <div className="results-head">
          {switcher}
          <div>
            <h1 className="title">Seus favoritos</h1>
            <p className="sub">
              {p.favorites.length
                ? `${p.favorites.length} ${p.favorites.length === 1 ? "imóvel guardado" : "imóveis guardados"} neste navegador. Ficam aqui mesmo depois de uma nova busca.`
                : "Guarde aqui os imóveis que chamaram atenção para comparar com calma."}
            </p>
          </div>
          {p.favorites.length > 1 && (
            <div className="row between">
              <span className="hint">Ordenar por</span>
              <SortPicker value={f.sort} onChange={(sort) => p.setFilters({ ...f, sort })} />
            </div>
          )}
        </div>
        <div className="results-body">
          {p.favorites.length ? (
            <div className="cards">{p.favorites.map(renderCard)}</div>
          ) : (
            <div className="fav-empty">
              <span className="fav-empty-icon">
                <Icon name="heart" size={28} />
              </span>
              <b>Nenhum imóvel favoritado ainda</b>
              <span>Toque no coração de um imóvel da lista, do mapa ou dos detalhes para guardá-lo aqui.</span>
              <button type="button" className="btn primary" onClick={() => p.setListMode("all")}>
                Ver todos os imóveis
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="results">
      <div className="results-head">
        {switcher}
        {s.busy && (
          <div className="progress" role="status">
            <Spinner />
            <div>
              <b>{s.busy === "analyze" ? "Analisando a cidade…" : "Buscando imóveis…"}</b>
              {lastMsg && <span>{lastMsg}</span>}
              {s.busy === "analyze" && (
                <span className="muted">
                  A primeira análise de uma cidade pode levar alguns minutos. Depois fica em cache.
                </span>
              )}
            </div>
          </div>
        )}
        {s.error && <ErrorAlert>{s.error}</ErrorAlert>}

        {!a && !s.busy && (
          <div className="empty">
            <h1 className="title">Vamos achar o seu lugar</h1>
            <p className="sub">
              Responda o básico (onde trabalha, quanto quer pagar e quantos quartos) e a gente mostra o que cabe e o que
              chega perto.
            </p>
            {p.canRun ? (
              <button type="button" className="btn primary big" onClick={p.onRunAll}>
                Mostrar imóveis <Icon name="chevR" />
              </button>
            ) : (
              <button type="button" className="btn primary big" onClick={() => p.onEdit(0)}>
                Configurar a busca <Icon name="chevR" />
              </button>
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
                      ? s.busy
                        ? "Buscando imóveis…"
                        : "Nenhum imóvel ainda"
                      : ideal
                        ? `${ideal} ${ideal === 1 ? "imóvel atende" : "imóveis atendem"} a tudo`
                        : good
                          ? `${good} ${good === 1 ? "imóvel cabe" : "imóveis cabem"} no preço e nos quartos`
                          : almost
                            ? `${almost} ${almost === 1 ? "imóvel chega" : "imóveis chegam"} perto`
                            : `${others} ${others === 1 ? "opção" : "opções"} perto do que você pediu`}
              </h1>
              {a.regions.length > 0 && p.ranked.length > 0 && (
                <p className="sub">
                  {[
                    ideal && good ? `+${good} com o essencial ok` : "",
                    (ideal || good) && almost ? `+${almost} quase lá` : "",
                  ]
                    .filter(Boolean)
                    .map((t) => (
                      <b key={t}>{t} · </b>
                    ))}
                  em {searched.length || selectedRegions.length}{" "}
                  {searched.length === 1 ? "região recomendada" : "regiões recomendadas"}.
                </p>
              )}
            </div>

            {a.regions.length === 0 && !s.busy && (
              <div className="alert">
                <span>
                  Nenhuma região atinge o que você pediu. Aumente as distâncias dos lugares ou mude as prioridades (por
                  exemplo, deixe um lugar como "bom ter").
                </span>
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => p.onEdit(1)}>
                    Mudar prioridades
                  </button>
                  <button type="button" className="btn" onClick={() => p.onEdit(2)}>
                    Rever as distâncias
                  </button>
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
                  <button
                    key={t.id}
                    type="button"
                    className="pill"
                    aria-pressed={p.regionTab === t.id}
                    onClick={() => p.setRegionTab(t.id)}
                  >
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
                <SortPicker value={f.sort} onChange={(sort) => p.setFilters({ ...f, sort })} />
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
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => p.setFilters({ ...f, hideUnknown: false })}
                >
                  Mostrar os que não informam
                </button>
              )}
              <button type="button" className="btn" onClick={() => p.onEdit(3)}>
                Mudar filtros
              </button>
            </div>
          </div>
        )}
        {a && a.regions.length > 0 && !s.busy && !s.sources.length && (
          <div className="alert">
            Nenhum site marcado para buscar anúncios.
            <div className="row">
              <button type="button" className="btn primary" onClick={() => p.onEdit(3)}>
                Escolher os sites
              </button>
            </div>
          </div>
        )}
        {a &&
          a.regions.length > 0 &&
          !s.busy &&
          s.searchedWith !== null &&
          s.listings.length === 0 &&
          s.sources.length > 0 && (
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
                    {s.diagnosis.others > 0 &&
                      ` Dentro do teto há ${s.diagnosis.others} de outros tipos ou com menos quartos (a partir de ${money(s.diagnosis.othersCheapest!)}).`}
                  </span>
                  <div className="row">
                    {s.diagnosis.cheapestSame != null && f.budget && (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() =>
                          p.onApplyFilters(
                            withBudget(f, f.budget!, slackToReach(f.budget!, s.diagnosis!.cheapestSame!)),
                          )
                        }
                      >
                        Aceitar até {money(s.diagnosis.cheapestSame)}
                      </button>
                    )}
                    {s.diagnosis.others > 0 && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => p.onApplyFilters({ ...f, types: [], minBedrooms: 0 })}
                      >
                        Ver os {s.diagnosis.others} de outros tipos
                      </button>
                    )}
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
                <h2 className="h3">
                  {title} <span className="tier-count">{list.length}</span>
                </h2>
                {collapsed ? (
                  <button type="button" className="linkbtn" onClick={() => setShowOthers(true)}>
                    Mostrar
                  </button>
                ) : (
                  <span className="hint">{hint}</span>
                )}
              </div>
              {!collapsed && <div className="cards">{list.slice(0, 120).map(renderCard)}</div>}
              {!collapsed && list.length > 120 && (
                <p className="hint center">Mostrando os 120 primeiros. Ordene por preço ou trajeto para ver outros.</p>
              )}
            </section>
          );
        })}

        {a && a.regions.length > 0 && (
          <details className="regions-box">
            <summary>
              <span>Regiões encontradas</span>
              <span className="muted">
                {shownRegions.length} no total · {selectedRegions.length} na busca de imóveis
              </span>
            </summary>
            <div className="seg small" role="group" aria-label="Quais regiões mostrar">
              {MIN_LEVELS.map(([l, label]) => (
                <button key={l} type="button" aria-pressed={s.minLevel === l} onClick={() => s.setMinLevel(l)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">
              Áreas: {a.stats.levels.excelente} excelentes, {a.stats.levels.boa} boas e {a.stats.levels.ok} ok. O melhor
              tempo até o trabalho é {a.stats.commuteBestMin} min; até {a.stats.commuteRefMin} min o transporte conta
              como atingido. Marque as regiões e busque de novo.
            </p>
            <ol className="regions">
              {shownRegions.slice(0, 30).map((r) => (
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
                    <span className="rname">
                      {r.rank}. {r.name}
                      <span className="rtag level" style={{ background: LEVEL_COLOR[r.level] }}>
                        {LEVEL_LABEL[r.level]}
                      </span>
                    </span>
                    <span className="rmeta">
                      <Icon name="bus" size={12} />{" "}
                      {noTransitNear({ via: r.via[0] ?? "", commuteMin: r.commuteMin })
                        ? "sem ônibus por perto"
                        : `${r.commuteMin}–${r.commuteAvg} min`}
                      {Object.entries(r.featureDist).map(([k, d]) => (
                        <span key={k} className="rfeat" title={p.features.find((x) => x.id === k)?.label}>
                          <Icon name={FEATURE_ICON[k] ?? "pin"} size={12} /> {meters(d)}
                        </span>
                      ))}
                    </span>
                  </button>
                  <span className="score" title="Nota da região (prioridades atingidas)">
                    {r.score.toFixed(0)}
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={`btn ${p.stale ? "primary" : ""}`}
              disabled={s.busy !== null || !selectedRegions.length || !s.sources.length}
              onClick={() => p.onRunListings(selectedRegions)}
            >
              <Icon name="refresh" /> Buscar imóveis em {selectedRegions.length}{" "}
              {selectedRegions.length === 1 ? "região" : "regiões"}
            </button>
          </details>
        )}

        {warnings.length > 0 && (
          <details className="warnings">
            <summary>
              {warnings.length} {warnings.length === 1 ? "aviso" : "avisos"} da busca
            </summary>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w.replace(/^Aviso: /, "")}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/** Ordem da lista (nota, preço, trajeto, área). */
function SortPicker({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  return (
    <Segmented
      className="small"
      label="Ordenar"
      value={value}
      onChange={onChange}
      options={SORTS.map(([k, label]) => ({ value: k, label }))}
    />
  );
}
