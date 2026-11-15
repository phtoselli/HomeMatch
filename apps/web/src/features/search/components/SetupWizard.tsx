import { useEffect, useRef, useState } from "react";
import { PROPERTY_TYPE_LABEL } from "@homematch/contracts/constants";
import type { City, FeatureDef, LatLng, PlaceResult, TransitOperatorInfo } from "@homematch/contracts";
import {
  AMENITY_FILTERS,
  SEARCH_TYPES,
  WIDE,
  ceilingOf,
  meters,
  money,
  walkMin,
  withBudget,
  type Filters,
} from "@homematch/domain";
import { api } from "@/shared/api/client";
import { AMENITY_ICON, FEATURE_ICON, Icon, Spinner } from "@/shared/ui";
import type { Search } from "../hooks/useSearch";
import { SearchBox } from "./SearchBox";
import { SourcesPicker, sourcesSummary } from "./SourcesPicker";

interface Props {
  /** 0–1: o básico; 2 ou mais: abre já com "Mais opções" aberto (ex.: chip "Mais filtros"). */
  step: number;
  setStep: (n: number) => void;
  city: City | null;
  loadingCity: boolean;
  operator: TransitOperatorInfo | null;
  onChooseCity: (osmId: string) => void;
  work: (LatLng & { label?: string }) | null;
  onWork: (pl: PlaceResult) => void;
  onPickOnMap: () => void;
  features: FeatureDef[];
  search: Search;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onAddLine: (q: string) => Promise<string>;
  onFinish: () => void;
  onClose?: () => void;
}

const TIMES = [30, 45, 60, 90];
const ROOMS: [number, string][] = [
  [0, "Tanto faz"],
  [1, "1+"],
  [2, "2+"],
  [3, "3+"],
];
const SLACKS = [0, 10, 15, 25];
const RADII = [300, 500, 800, 1000, 1500, 2000, 3000];

/**
 * Uma tela só, com o essencial: onde trabalha, quanto quer pagar, quartos, tempo e o que quer perto.
 * Tudo tem um padrão razoável; o resto fica em "Mais opções". O que passar um pouco do pedido não some:
 * aparece como "quase lá", dizendo o que não bate.
 */
export function SetupWizard(p: Props) {
  const { search: s, filters: f } = p;
  const setF = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });
  const [moreOpen, setMoreOpen] = useState(p.step >= 2);
  const [cityEdit, setCityEdit] = useState(!p.city);
  const [line, setLine] = useState("");
  const [lineMsg, setLineMsg] = useState<string | null>(null);
  const [lineBusy, setLineBusy] = useState(false);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const sourcesRef = useRef<HTMLFieldSetElement>(null);

  function showSources() {
    setMoreOpen(true);
    setTimeout(() => sourcesRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  }

  useEffect(() => {
    if (p.step >= 2) {
      setMoreOpen(true);
      setTimeout(() => moreRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
    }
  }, [p.step]);
  useEffect(() => {
    if (p.city) setCityEdit(false);
  }, [p.city?.osmId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!p.city && !!p.work;
  const ceiling = ceilingOf(f.budget, f.slack);
  const chosenDefs = p.features.filter((d) => d.id in s.chosen);

  async function addLine() {
    const q = line.trim();
    if (!q) return;
    setLineBusy(true);
    setLineMsg(await p.onAddLine(q));
    setLineBusy(false);
  }

  function toggleFeature(d: FeatureDef) {
    const n = { ...s.chosen };
    if (d.id in n) delete n[d.id];
    else n[d.id] = d.defaultRadius;
    s.setChosen(n);
  }

  return (
    <div className="setup quick">
      <section className="card quick-card">
        <div className="quick-head">
          <div>
            <span className="eyebrow">Sua busca</span>
            <h1 className="display">O que você procura?</h1>
            <p className="lead">
              Responda o básico e a gente mostra os imóveis que atendem a tudo e os que chegam perto, dizendo o que
              falta em cada um.
            </p>
          </div>
          {p.onClose && (
            <button type="button" className="btn ghost" onClick={p.onClose}>
              <Icon name="x" /> Fechar
            </button>
          )}
        </div>

        <div className="qgrid">
          <div className="field q wide">
            <span className="qnum">1</span>
            <span className="label">Em que cidade você quer morar?</span>
            {cityEdit || !p.city ? (
              <SearchBox
                placeholder="Ex.: Campinas, e aperte Enter"
                initial={p.city ? `${p.city.name}${p.city.stateCode ? ` - ${p.city.stateCode}` : ""}` : ""}
                search={api.cities}
                minChars={2}
                onSelect={(pl) => p.onChooseCity(pl.osmId)}
              />
            ) : (
              <p className="hint city-line">
                <Icon name="pin" size={14} /> {p.city.name}
                {p.city.stateCode ? ` - ${p.city.stateCode}` : ""}
                {p.operator && <span className="muted"> · ônibus: {p.operator.name}</span>}
                <button type="button" className="linkbtn" onClick={() => setCityEdit(true)}>
                  Trocar cidade
                </button>
              </p>
            )}
            {p.city && (
              <p className="hint city-line">
                {s.loadingSources ? <Spinner small /> : <Icon name="home" size={14} />} {sourcesSummary(s, p.city.name)}
                {!s.loadingSources && (
                  <button type="button" className="linkbtn" onClick={showSources}>
                    Ver quais
                  </button>
                )}
              </p>
            )}
            {p.loadingCity && (
              <p className="hint">
                <Spinner small /> Carregando os limites da cidade…
              </p>
            )}
          </div>

          <div className="field q wide">
            <span className="qnum">2</span>
            <span className="label">Onde você trabalha ou estuda?</span>
            {!p.city ? (
              <p className="hint">Escolha a cidade acima primeiro.</p>
            ) : (
              <>
                <SearchBox
                  placeholder="Rua e número (e a cidade, se for outra), e aperte Enter"
                  initial={p.work?.label ?? ""}
                  search={(q) => api.geocode(q, p.city?.bbox)}
                  onSelect={p.onWork}
                />
                <div className="row">
                  {p.work?.label && (
                    <span className="hint">
                      <Icon name="brief" size={13} /> {p.work.label}
                    </span>
                  )}
                  <button type="button" className="btn small" onClick={p.onPickOnMap}>
                    <Icon name="target" /> {p.work ? "Ajustar no mapa" : "Marcar no mapa"}
                  </button>
                </div>
                <span className="hint">
                  Pode ser em outra cidade da região: escreva o nome dela no fim (ex.: Av. Norte-Sul, 500, Campinas).
                </span>
              </>
            )}
          </div>

          <div className="field q">
            <span className="qnum">3</span>
            <label className="label" htmlFor="budget">
              Quanto quer pagar por mês?
            </label>
            <div className="row">
              <div className="money-input">
                <span>R$</span>
                <input
                  id="budget"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  placeholder="2300"
                  value={f.budget ?? ""}
                  onChange={(e) => p.setFilters(withBudget(f, e.target.value ? Number(e.target.value) : null))}
                />
              </div>
              <div className="seg small" role="group" aria-label="O valor é">
                <button type="button" aria-pressed={f.basis === "total"} onClick={() => setF({ basis: "total" })}>
                  Com condomínio
                </button>
                <button type="button" aria-pressed={f.basis === "rent"} onClick={() => setF({ basis: "rent" })}>
                  Só aluguel
                </button>
              </div>
            </div>
            <span className="hint">
              {ceiling
                ? `Atende até ${money(ceiling)}; até ${money(Math.round(ceiling * (1 + WIDE.price)))} aparece como "quase lá".`
                : "Em branco: qualquer preço."}
            </span>
          </div>

          <fieldset className="field q">
            <span className="qnum">4</span>
            <legend className="label">Quantos quartos?</legend>
            <div className="chips">
              {ROOMS.map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  className="choice"
                  aria-pressed={f.minBedrooms === n}
                  onClick={() => setF({ minBedrooms: n })}
                >
                  {label}
                </button>
              ))}
            </div>
            {f.minBedrooms > 1 && <span className="hint">Com {f.minBedrooms - 1} quarto aparece como "quase lá".</span>}
          </fieldset>

          <fieldset className="field q">
            <span className="qnum">5</span>
            <legend className="label">Tempo máximo até o trabalho</legend>
            <div className="chips">
              {TIMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="choice"
                  aria-pressed={s.params.maxCommuteMin === t}
                  onClick={() => s.setParams({ ...s.params, maxCommuteMin: t })}
                >
                  {t} min
                </button>
              ))}
              {!TIMES.includes(s.params.maxCommuteMin) && (
                <button type="button" className="choice" aria-pressed>
                  {s.params.maxCommuteMin} min
                </button>
              )}
            </div>
            <span className="hint">De porta a porta, de ônibus. Até 15 min a mais aparece como "quase lá".</span>
          </fieldset>

          <fieldset className="field q wide">
            <span className="qnum">6</span>
            <legend className="label">
              O que quer ter perto de casa? <span className="muted">(opcional)</span>
            </legend>
            <div className="chips">
              {p.features.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="choice"
                  aria-pressed={d.id in s.chosen}
                  title={d.description}
                  onClick={() => toggleFeature(d)}
                >
                  <Icon name={FEATURE_ICON[d.id] ?? "pin"} /> {d.label.split(" / ")[0]}
                </button>
              ))}
            </div>
            {chosenDefs.length > 0 && (
              <span className="hint">
                A pé:{" "}
                {chosenDefs
                  .map((d) => `${d.label.split(" / ")[0]!.toLowerCase()} até ${meters(s.chosen[d.id]!)}`)
                  .join(", ")}
                . Mude as distâncias em "Mais opções".
              </span>
            )}
          </fieldset>

          <fieldset className="field q wide">
            <span className="qnum">7</span>
            <legend className="label">
              O imóvel precisa ter <span className="muted">(opcional)</span>
            </legend>
            <div className="chips">
              {AMENITY_FILTERS.map((a) => {
                const on = (f.amenities ?? []).includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="choice"
                    aria-pressed={on}
                    onClick={() =>
                      setF({
                        amenities: on ? (f.amenities ?? []).filter((x) => x !== a.id) : [...(f.amenities ?? []), a.id],
                      })
                    }
                  >
                    <Icon name={AMENITY_ICON[a.id] ?? "check"} /> {a.label}
                  </button>
                );
              })}
            </div>
            <span className="hint">
              Muitos anúncios não dizem. Esses continuam na lista, marcados com "?"; só sai do topo quem diz que não
              tem.
            </span>
          </fieldset>
        </div>

        <details
          className="more"
          ref={moreRef}
          open={moreOpen}
          onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            Mais opções{" "}
            <span className="muted">(tipo de imóvel, distâncias, linha de ônibus, sites e imobiliárias)</span>
          </summary>

          <fieldset className="field">
            <legend className="label">Tipo de imóvel</legend>
            <div className="chips">
              {SEARCH_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="choice"
                  aria-pressed={f.types.includes(t)}
                  onClick={() =>
                    setF({ types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })
                  }
                >
                  {PROPERTY_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <span className="hint">
              {f.types.length ? 'Os outros tipos aparecem como "quase lá".' : "Nenhum marcado: qualquer tipo."}
            </span>
          </fieldset>

          <fieldset className="field">
            <legend className="label">Se o imóvel for muito bom, aceito passar do orçamento até</legend>
            <div className="chips">
              {SLACKS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="choice"
                  aria-pressed={(f.slack ?? 0) === k}
                  onClick={() => p.setFilters(withBudget(f, f.budget ?? null, k))}
                >
                  {k ? `+${k}%` : "Nada"}
                </button>
              ))}
            </div>
          </fieldset>

          {chosenDefs.length > 0 && (
            <fieldset className="field">
              <legend className="label">Distância a pé de cada lugar</legend>
              <div className="dist-grid">
                {chosenDefs.map((d) => (
                  <label key={d.id} className="dist-row">
                    <Icon name={FEATURE_ICON[d.id] ?? "pin"} /> <span>{d.label}</span>
                    <select
                      value={s.chosen[d.id]}
                      onChange={(e) => s.setChosen({ ...s.chosen, [d.id]: Number(e.target.value) })}
                    >
                      {[...new Set([...RADII, s.chosen[d.id]!])]
                        .sort((a, b) => a - b)
                        .map((r) => (
                          <option key={r} value={r}>
                            até {meters(r)} · ~{walkMin(r)} min
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="field">
            <label className="label" htmlFor="line">
              Linha de ônibus que gostaria perto
            </label>
            <div className="row">
              <div className="money-input line-input">
                <Icon name="bus" size={18} />
                <input
                  id="line"
                  value={line}
                  placeholder="Ex.: 353"
                  onChange={(e) => setLine(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLine()}
                />
              </div>
              <button type="button" className="btn" disabled={lineBusy || !line.trim()} onClick={addLine}>
                {lineBusy ? <Spinner small /> : <Icon name="pin" />} Mostrar no mapa
              </button>
            </div>
            <span className="hint">
              {lineMsg ?? "O trajeto e os pontos aparecem no mapa, e cada imóvel mostra a distância até o ponto."}
            </span>
          </div>

          <div className="grid3">
            <label className="field">
              <span className="label">Banheiros</span>
              <select value={f.minBathrooms ?? 0} onChange={(e) => setF({ minBathrooms: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} ou mais` : "Qualquer"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Vagas</span>
              <select value={f.minParking ?? 0} onChange={(e) => setF({ minParking: Number(e.target.value) })}>
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} ou mais` : "Qualquer"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Área mínima (m²)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                placeholder="Qualquer"
                value={f.minArea || ""}
                onChange={(e) => setF({ minArea: Number(e.target.value) || 0 })}
              />
            </label>
          </div>

          <fieldset className="field" ref={sourcesRef}>
            <legend className="label">Onde buscar</legend>
            <SourcesPicker s={s} cityName={p.city?.name} />
          </fieldset>

          <label className="check">
            <input type="checkbox" checked={!!f.hideUnknown} onChange={() => setF({ hideUnknown: !f.hideUnknown })} />
            Esconder anúncios que não dizem se têm os itens da pergunta 6
          </label>

          <div className="grid3">
            <label className="field">
              <span className="label">Caminhada até o ponto: {meters(s.params.maxWalkToStopM)}</span>
              <input
                type="range"
                min={200}
                max={1500}
                step={50}
                value={s.params.maxWalkToStopM}
                onChange={(e) => s.setParams({ ...s.params, maxWalkToStopM: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="label">Tempo exato: {s.params.maxCommuteMin} min</span>
              <input
                type="range"
                min={15}
                max={120}
                step={5}
                value={s.params.maxCommuteMin}
                onChange={(e) => s.setParams({ ...s.params, maxCommuteMin: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="label">Anúncios por região</span>
              <select value={s.maxPerRegion} onChange={(e) => s.setMaxPerRegion(Number(e.target.value))}>
                {[50, 100, 200, 300].map((n) => (
                  <option key={n} value={n}>
                    até {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <div className="setup-foot">
          <span className="hint">
            {!p.city
              ? "Falta a cidade (pergunta 1)."
              : !p.work
                ? "Falta o endereço do trabalho (pergunta 1)."
                : "Se vier pouca coisa, a busca se amplia sozinha para mais bairros."}
          </span>
          <button type="button" className="btn primary big" disabled={!ready || s.busy !== null} onClick={p.onFinish}>
            Mostrar imóveis <Icon name="chevR" />
          </button>
        </div>
      </section>
    </div>
  );
}
