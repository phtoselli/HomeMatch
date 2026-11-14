import { useEffect, useRef, useState } from "react";
import type { City, FeatureDef, LatLng, PlaceResult, TransitOperatorInfo } from "../../shared/types";
import { PROPERTY_TYPE_LABEL } from "../../shared/types";
import { api } from "../api";
import { meters, money, walkMin } from "../format";
import { FEATURE_ICON, Icon, type IconName } from "../icons";
import { AMENITY_FILTERS, SEARCH_TYPES, ceilingOf, withBudget, type Filters } from "../search";
import type { Search } from "../useSearch";
import { SearchBox } from "./SearchBox";

interface Props {
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

const STEPS = [
  { label: "Trabalho", q: "Onde você trabalha?", h: "Tudo parte daqui: o tempo de ônibus de cada bairro é medido até esse endereço." },
  { label: "Tempo e orçamento", q: "Quanto tempo e quanto dinheiro?", h: "Pense no trajeto de porta a porta, contando a caminhada e a espera do ônibus." },
  { label: "Perto de casa", q: "O que precisa ficar perto?", h: "Sem carro, o que importa é dar para ir a pé. Escolha o que não pode faltar." },
  { label: "Imóvel", q: "Como é o imóvel?", h: "Os sites nem sempre informam tudo. Você decide se quer ver os anúncios que não dizem." },
];

const TIMES = [30, 45, 60, 75];
const SLACKS = [0, 10, 15, 25];
const RADII = [300, 500, 800, 1000, 1500, 2000, 3000];

export function SetupWizard(p: Props) {
  const { search: s, filters: f } = p;
  const setF = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });
  const [line, setLine] = useState("");
  const [lineMsg, setLineMsg] = useState<string | null>(null);
  const [lineBusy, setLineBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Trocar de passo volta ao topo (a área rola por inteiro).
  useEffect(() => {
    root.current?.parentElement?.scrollTo({ top: 0 }); // (nada de retornar: no Chrome novo scrollTo devolve uma Promise)
  }, [p.step]);
  const cur = STEPS[p.step]!;
  const ready = !!p.city && !!p.work;

  const nearLabels = p.features.filter((d) => d.id in s.chosen).map((d) => `${d.label} (${meters(s.chosen[d.id]!)})`);
  const amenLabels = AMENITY_FILTERS.filter((a) => f.amenities?.includes(a.id)).map((a) => a.label.toLowerCase());
  const summary: { icon: IconName; label: string; value: string; step: number }[] = [
    { icon: "brief", label: "Trabalho", value: p.work?.label ? `${p.work.label}${p.city ? ` · ${p.city.name}` : ""}` : p.city ? `${p.city.name} · falta o endereço` : "Escolha a cidade e o endereço", step: 0 },
    { icon: "clock", label: "Trajeto", value: `Até ${s.params.maxCommuteMin} min · até ${meters(s.params.maxWalkToStopM)} a pé até o ponto`, step: 1 },
    {
      icon: "wallet",
      label: "Orçamento",
      value: f.budget ? `${money(f.budget)} ${f.basis === "total" ? "total" : "de aluguel"}${f.slack ? ` (até ${money(ceilingOf(f.budget, f.slack)!)})` : ""}` : "Sem limite de preço",
      step: 1,
    },
    { icon: "pin", label: "Perto de casa", value: nearLabels.join(", ") || "Nada marcado", step: 2 },
    {
      icon: "home",
      label: "Imóvel",
      value: [
        f.types.length ? f.types.map((t) => PROPERTY_TYPE_LABEL[t]).join(", ") : "Qualquer tipo",
        f.minBedrooms ? `${f.minBedrooms}+ quartos` : "",
        amenLabels.join(", "),
      ].filter(Boolean).join(" · "),
      step: 3,
    },
  ];

  const last = s.analysis;
  const preview = last
    ? `Última busca: ${last.regions.length} ${last.regions.length === 1 ? "região cabe" : "regiões cabem"} no tempo e no que você pediu.`
    : "Ao buscar, calculamos quais bairros cabem no tempo e têm o que você pediu por perto.";

  async function addLine() {
    const q = line.trim();
    if (!q) return;
    setLineBusy(true);
    setLineMsg(await p.onAddLine(q));
    setLineBusy(false);
  }

  return (
    <div className="setup" ref={root}>
      <nav className="steps" aria-label="Passos">
        {STEPS.map((st, i) => (
          <button key={st.label} type="button" className="stepbtn" aria-current={i === p.step ? "step" : undefined} data-done={i < p.step || undefined} onClick={() => p.setStep(i)}>
            <span className="dot">{i < p.step ? <Icon name="check" size={13} stroke={3} /> : i + 1}</span>
            {st.label}
          </button>
        ))}
        {p.onClose && (
          <button type="button" className="btn ghost close" onClick={p.onClose}>
            <Icon name="x" /> Fechar
          </button>
        )}
      </nav>

      <div className="setup-body">
        <section className="card setup-form">
          <div>
            <span className="eyebrow">Passo {p.step + 1} de 4</span>
            <h1 className="display">{cur.q}</h1>
            <p className="lead">{cur.h}</p>
          </div>

          {p.step === 0 && (
            <div className="fields">
              <div className="field">
                <span className="label">Cidade</span>
                <SearchBox
                  placeholder="Ex.: Campinas, e aperte Enter"
                  initial={p.city ? `${p.city.name}${p.city.stateCode ? ` - ${p.city.stateCode}` : ""}` : ""}
                  search={api.cities}
                  minChars={2}
                  onSelect={(pl) => p.onChooseCity(pl.osmId)}
                />
                {p.loadingCity && <p className="hint"><span className="spinner small" /> Carregando os limites da cidade…</p>}
                {p.city && !p.loadingCity && (
                  <div className={`note ${p.operator ? "ok" : ""}`}>
                    <Icon name="bus" size={18} />
                    {p.operator ? (
                      <span>
                        <b>Ônibus da cidade: {p.operator.name}.</b> Usamos as linhas e os pontos oficiais (
                        <a href={p.operator.site} target="_blank" rel="noopener">site</a>).
                      </span>
                    ) : (
                      <span>Sem empresa de ônibus cadastrada para {p.city.name}: usamos as linhas do OpenStreetMap.</span>
                    )}
                  </div>
                )}
              </div>
              <div className="field">
                <span className="label">Endereço do trabalho</span>
                <SearchBox
                  placeholder="Rua e número, e aperte Enter"
                  initial={p.work?.label ?? ""}
                  search={(q) => api.geocode(q, p.city?.bbox)}
                  onSelect={p.onWork}
                />
                <div className="row">
                  <span className="hint">Não achou? </span>
                  <button type="button" className="btn small" onClick={p.onPickOnMap}>
                    <Icon name="target" /> Marcar no mapa
                  </button>
                </div>
                {p.work?.label && <p className="hint"><Icon name="brief" size={13} /> {p.work.label}</p>}
              </div>
            </div>
          )}

          {p.step === 1 && (
            <div className="fields">
              <fieldset className="field">
                <legend className="label">Tempo máximo até o trabalho, de porta a porta</legend>
                <div className="chips">
                  {TIMES.map((t) => (
                    <button key={t} type="button" className="choice" aria-pressed={s.params.maxCommuteMin === t} onClick={() => s.setParams({ ...s.params, maxCommuteMin: t })}>
                      {t} min
                    </button>
                  ))}
                  {!TIMES.includes(s.params.maxCommuteMin) && <button type="button" className="choice" aria-pressed>{s.params.maxCommuteMin} min</button>}
                </div>
                <div className="note">
                  <Icon name="clock" size={18} />
                  <span>
                    O tempo conta a caminhada até o ponto, ~8 min de espera por ônibus e a viagem. Com uma baldeação são duas esperas, então
                    trajetos com troca só cabem a partir de uns 55–60 min.
                  </span>
                </div>
              </fieldset>
              <div className="field">
                <label className="label" htmlFor="budget">Quanto quer gastar por mês</label>
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
                  <div className="seg" role="group" aria-label="O valor é">
                    <button type="button" aria-pressed={f.basis === "total"} onClick={() => setF({ basis: "total" })}>Total (aluguel + condomínio)</button>
                    <button type="button" aria-pressed={f.basis === "rent"} onClick={() => setF({ basis: "rent" })}>Só aluguel</button>
                  </div>
                </div>
              </div>
              <fieldset className="field">
                <legend className="label">Se o imóvel for muito bom, aceito passar até</legend>
                <div className="chips">
                  {SLACKS.map((k) => (
                    <button key={k} type="button" className="choice" aria-pressed={(f.slack ?? 0) === k} onClick={() => p.setFilters(withBudget(f, f.budget ?? null, k))}>
                      {k ? `+${k}%` : "Nada"}
                    </button>
                  ))}
                </div>
                <span className="hint">
                  {f.budget ? `A busca vai até ${money(ceilingOf(f.budget, f.slack)!)}. ` : ""}Os que passam do alvo aparecem marcados com quanto passam.
                </span>
              </fieldset>
              <details className="more">
                <summary>Ajustes finos da análise</summary>
                <label className="field">
                  <span className="label">Caminhada até o ponto: {meters(s.params.maxWalkToStopM)} (~{walkMin(s.params.maxWalkToStopM)} min)</span>
                  <input type="range" min={200} max={1500} step={50} value={s.params.maxWalkToStopM} onChange={(e) => s.setParams({ ...s.params, maxWalkToStopM: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span className="label">Tempo máximo exato: {s.params.maxCommuteMin} min</span>
                  <input type="range" min={15} max={120} step={5} value={s.params.maxCommuteMin} onChange={(e) => s.setParams({ ...s.params, maxCommuteMin: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span className="label">Peso do trajeto na nota da região: {Math.round(s.params.commuteWeight * 100)}%</span>
                  <input type="range" min={0} max={1} step={0.05} value={s.params.commuteWeight} onChange={(e) => s.setParams({ ...s.params, commuteWeight: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span className="label">Precisão da grade</span>
                  <select value={s.params.cellSizeM} onChange={(e) => s.setParams({ ...s.params, cellSizeM: Number(e.target.value) })}>
                    <option value={300}>Fina (300 m, mais lenta)</option>
                    <option value={500}>Normal (500 m)</option>
                    <option value={800}>Grossa (800 m, cidades grandes)</option>
                  </select>
                </label>
              </details>
            </div>
          )}

          {p.step === 2 && (
            <div className="fields">
              <div className="place-grid">
                {p.features.map((d) => {
                  const on = d.id in s.chosen;
                  return (
                    <div key={d.id} className="place" data-on={on || undefined}>
                      <button
                        type="button"
                        className="place-toggle"
                        aria-pressed={on}
                        title={d.description}
                        onClick={() => {
                          const n = { ...s.chosen };
                          if (on) delete n[d.id];
                          else n[d.id] = d.defaultRadius;
                          s.setChosen(n);
                        }}
                      >
                        <span className="place-icon"><Icon name={FEATURE_ICON[d.id] ?? "pin"} size={20} /></span>
                        <span className="place-label">{d.label}</span>
                        <span className="place-check"><Icon name="check" size={13} stroke={3} /></span>
                      </button>
                      {on && (
                        <label className="place-dist">
                          <span className="sr-only">Distância máxima até {d.label}</span>
                          <select value={s.chosen[d.id]} onChange={(e) => s.setChosen({ ...s.chosen, [d.id]: Number(e.target.value) })}>
                            {[...new Set([...RADII, s.chosen[d.id]!])].sort((a, b) => a - b).map((r) => (
                              <option key={r} value={r}>até {meters(r)} · ~{walkMin(r)} min a pé</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="field">
                <label className="label" htmlFor="line">Linha de ônibus que gostaria perto <span className="muted">(opcional)</span></label>
                <div className="row">
                  <div className="money-input line-input">
                    <Icon name="bus" size={18} />
                    <input id="line" value={line} placeholder="Ex.: 353" onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                  </div>
                  <button type="button" className="btn" disabled={lineBusy || !line.trim()} onClick={addLine}>
                    {lineBusy ? <span className="spinner small" /> : <Icon name="pin" />} Mostrar no mapa
                  </button>
                </div>
                <span className="hint">{lineMsg ?? "O trajeto e os pontos da linha aparecem no mapa, e cada imóvel mostra a distância até o ponto."}</span>
              </div>
            </div>
          )}

          {p.step === 3 && (
            <div className="fields">
              <fieldset className="field">
                <legend className="label">Tipo de imóvel</legend>
                <div className="chips">
                  {SEARCH_TYPES.map((t) => (
                    <button key={t} type="button" className="choice" aria-pressed={f.types.includes(t)} onClick={() => setF({ types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })}>
                      {PROPERTY_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                {!f.types.length && <span className="hint">Nenhum marcado: vale qualquer tipo.</span>}
              </fieldset>
              <fieldset className="field">
                <legend className="label">Quartos</legend>
                <div className="chips">
                  {[0, 1, 2, 3].map((n) => (
                    <button key={n} type="button" className="choice" aria-pressed={f.minBedrooms === n} onClick={() => setF({ minBedrooms: n })}>
                      {n ? `${n}+` : "Qualquer"}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="field">
                <legend className="label">Precisa ter</legend>
                <div className="chips">
                  {AMENITY_FILTERS.map((a) => {
                    const on = (f.amenities ?? []).includes(a.id);
                    return (
                      <button key={a.id} type="button" className="choice" aria-pressed={on} onClick={() => setF({ amenities: on ? (f.amenities ?? []).filter((x) => x !== a.id) : [...(f.amenities ?? []), a.id] })}>
                        <Icon name={a.icon} /> {a.label}
                      </button>
                    );
                  })}
                </div>
                <label className="check">
                  <input type="checkbox" checked={!!f.hideUnknown} onChange={() => setF({ hideUnknown: !f.hideUnknown })} />
                  Esconder anúncios que não dizem se têm esses itens
                </label>
              </fieldset>
              <details className="more">
                <summary>Mais filtros e fontes</summary>
                <div className="grid3">
                  <label className="field">
                    <span className="label">Banheiros</span>
                    <select value={f.minBathrooms ?? 0} onChange={(e) => setF({ minBathrooms: Number(e.target.value) })}>
                      {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n ? `${n} ou mais` : "Qualquer"}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Vagas</span>
                    <select value={f.minParking ?? 0} onChange={(e) => setF({ minParking: Number(e.target.value) })}>
                      {[0, 1, 2].map((n) => <option key={n} value={n}>{n ? `${n} ou mais` : "Qualquer"}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Área mínima (m²)</span>
                    <input type="number" inputMode="numeric" min={0} step={5} placeholder="Qualquer" value={f.minArea || ""} onChange={(e) => setF({ minArea: Number(e.target.value) || 0 })} />
                  </label>
                </div>
                <fieldset className="field">
                  <legend className="label">Onde buscar</legend>
                  <div className="row">
                    {(["quintoandar", "vivareal"] as const).map((src) => (
                      <label key={src} className="check">
                        <input type="checkbox" checked={s.sources.includes(src)} onChange={() => s.setSources(s.sources.includes(src) ? s.sources.filter((x) => x !== src) : [...s.sources, src])} />
                        {src === "quintoandar" ? "QuintoAndar" : "VivaReal"}
                        {src === "vivareal" && <span className="muted">(costuma bloquear)</span>}
                      </label>
                    ))}
                    <label className="check">
                      até
                      <select className="inline-select" value={s.maxPerRegion} onChange={(e) => s.setMaxPerRegion(Number(e.target.value))}>
                        {[50, 100, 200, 300].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      por região
                    </label>
                  </div>
                </fieldset>
              </details>
            </div>
          )}

          <div className="setup-foot">
            <button type="button" className="btn" disabled={p.step === 0} onClick={() => p.setStep(p.step - 1)}>
              <Icon name="back" /> Voltar
            </button>
            {p.step < 3 ? (
              <button type="button" className="btn primary big" onClick={() => p.setStep(p.step + 1)}>
                Continuar <Icon name="chevR" />
              </button>
            ) : (
              <button type="button" className="btn primary big" disabled={!ready || s.busy !== null} onClick={p.onFinish}>
                Encontrar regiões e imóveis <Icon name="chevR" />
              </button>
            )}
          </div>
          {p.step === 3 && !ready && <p className="hint right">Falta {!p.city ? "a cidade" : "o endereço do trabalho"} (passo 1).</p>}
        </section>

        <aside className="setup-aside" aria-label="Resumo da busca">
          <div className="card">
            <h2 className="h2">Sua busca</h2>
            <ul className="sumlist">
              {summary.map((r) => (
                <li key={r.label}>
                  <span className="sumicon"><Icon name={r.icon} /></span>
                  <span className="sumtext">
                    <span className="k">{r.label}</span>
                    <span className="v">{r.value}</span>
                  </span>
                  <button type="button" className="linkbtn" aria-label={`Editar ${r.label.toLowerCase()}`} onClick={() => p.setStep(r.step)}>Editar</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="card dark">
            <span className="eyebrow light">Prévia</span>
            <p className="preview-text">{preview}</p>
            {last && last.regions.length < 3 && s.params.maxCommuteMin < 60 && (
              <p className="preview-sub">Poucas regiões? Com 60 min entram bairros com uma baldeação.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
