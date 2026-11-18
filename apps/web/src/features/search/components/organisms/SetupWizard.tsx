import { useEffect, useRef, useState } from "react";
import type { City, FeatureDef, LatLng, PlaceResult, TransitOperatorInfo } from "@homematch/contracts";
import {
  FILTERABLE_AMENITIES,
  SEARCH_TYPES,
  WIDE,
  amenityLabel,
  ceilingOf,
  meters,
  money,
  walkMin,
  withBudget,
  type Filters,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { api } from "@/shared/api/client";
import { shortLabel } from "@/shared/lib/format";
import { AMENITY_ICON, FEATURE_ICON, Icon, Spinner } from "@/shared/ui";
import type { Search } from "../../hooks/useSearch";
import { PrioritiesPicker } from "./PrioritiesPicker";
import { SearchBox } from "../molecules/SearchBox";
import { SourcesPicker, sourcesSummary } from "./SourcesPicker";

interface Props {
  /** 0–1: the basics; 2 or more: opens with "More options" expanded (e.g. the "More filters" chip). */
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

const msg = t.ui.setup;

const ROOMS: [number, string][] = [
  [0, msg.anyRooms],
  [1, "1+"],
  [2, "2+"],
  [3, "3+"],
];
const SLACKS = [0, 10, 15, 25];
const RADII = [300, 500, 800, 1000, 1500, 2000, 3000];

/**
 * A single screen with the essentials: where the user works, how much to pay, bedrooms, what to have nearby and
 * what matters most. Everything has a sensible default; the rest is under "More options". Near misses do not
 * disappear: they show up as "almost there", saying what does not match.
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
            <span className="eyebrow">{t.ui.topBar.yourSearch}</span>
            <h1 className="display">{msg.title}</h1>
            <p className="lead">{msg.lead}</p>
          </div>
          {p.onClose && (
            <button type="button" className="btn ghost" onClick={p.onClose}>
              <Icon name="x" /> {t.ui.common.close}
            </button>
          )}
        </div>

        <div className="qgrid">
          <div className="field q wide">
            <span className="qnum">1</span>
            <span className="label">{msg.cityQuestion}</span>
            {cityEdit || !p.city ? (
              <SearchBox
                placeholder={msg.cityPlaceholder}
                initial={p.city ? `${p.city.name}${p.city.stateCode ? ` - ${p.city.stateCode}` : ""}` : ""}
                search={api.cities}
                minChars={2}
                onSelect={(pl) => p.onChooseCity(pl.osmId)}
              />
            ) : (
              <p className="hint city-line">
                <Icon name="pin" size={14} /> {p.city.name}
                {p.city.stateCode ? ` - ${p.city.stateCode}` : ""}
                {p.operator && <span className="muted"> · {msg.busOperator(p.operator.name)}</span>}
                <button type="button" className="linkbtn" onClick={() => setCityEdit(true)}>
                  {msg.changeCity}
                </button>
              </p>
            )}
            {p.city && (
              <p className="hint city-line">
                {s.loadingSources ? <Spinner small /> : <Icon name="home" size={14} />} {sourcesSummary(s, p.city.name)}
                {!s.loadingSources && (
                  <button type="button" className="linkbtn" onClick={showSources}>
                    {msg.seeWhich}
                  </button>
                )}
              </p>
            )}
            {p.loadingCity && (
              <p className="hint">
                <Spinner small /> {msg.loadingCity}
              </p>
            )}
          </div>

          <div className="field q wide">
            <span className="qnum">2</span>
            <span className="label">{msg.workQuestion}</span>
            {!p.city ? (
              <p className="hint">{msg.chooseCityFirst}</p>
            ) : (
              <>
                <SearchBox
                  placeholder={msg.workPlaceholder}
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
                    <Icon name="target" /> {p.work ? msg.adjustOnMap : msg.markOnMap}
                  </button>
                </div>
                <span className="hint">{msg.workElsewhereHint}</span>
              </>
            )}
          </div>

          <div className="field q">
            <span className="qnum">3</span>
            <label className="label" htmlFor="budget">
              {msg.budgetQuestion}
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
              <div className="seg small" role="group" aria-label={msg.priceBasis}>
                <button type="button" aria-pressed={f.basis === "total"} onClick={() => setF({ basis: "total" })}>
                  {msg.withCondo}
                </button>
                <button type="button" aria-pressed={f.basis === "rent"} onClick={() => setF({ basis: "rent" })}>
                  {msg.rentOnly}
                </button>
              </div>
            </div>
            <span className="hint">
              {ceiling
                ? msg.budgetHint(money(ceiling), money(Math.round(ceiling * (1 + WIDE.price))))
                : msg.anyPriceHint}
            </span>
          </div>

          <fieldset className="field q">
            <span className="qnum">4</span>
            <legend className="label">{msg.roomsQuestion}</legend>
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
            {f.minBedrooms > 1 && <span className="hint">{msg.fewerRoomsHint(f.minBedrooms - 1)}</span>}
          </fieldset>

          <fieldset className="field q wide">
            <span className="qnum">5</span>
            <legend className="label">
              {msg.nearbyQuestion} <span className="muted">{msg.optional}</span>
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
                  <Icon name={FEATURE_ICON[d.id] ?? "pin"} /> {shortLabel(d.label)}
                </button>
              ))}
            </div>
            {chosenDefs.length > 0 && (
              <span className="hint">
                {msg.walkingDistances(chosenDefs.map((d) => [shortLabel(d.label), meters(s.chosen[d.id]!)]))}
              </span>
            )}
          </fieldset>

          <fieldset className="field q wide">
            <span className="qnum">6</span>
            <legend className="label">{msg.prioritiesQuestion}</legend>
            <PrioritiesPicker
              priorities={s.priorities}
              setPriorities={s.setPriorities}
              chosen={s.chosen}
              features={p.features}
            />
            <span className="hint">
              {msg.levelsHint.intro} <b>{msg.levelsHint.excellent}</b> {msg.levelsHint.excellentText}{" "}
              <b>{msg.levelsHint.good}</b> {msg.levelsHint.goodText} <b>{msg.levelsHint.ok}</b> {msg.levelsHint.okText}{" "}
              {msg.levelsHint.outro}
            </span>
          </fieldset>

          <fieldset className="field q wide">
            <span className="qnum">7</span>
            <legend className="label">
              {msg.mustHaveQuestion} <span className="muted">{msg.optional}</span>
            </legend>
            <div className="chips">
              {FILTERABLE_AMENITIES.map((id) => {
                const on = (f.amenities ?? []).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="choice"
                    aria-pressed={on}
                    onClick={() =>
                      setF({
                        amenities: on ? (f.amenities ?? []).filter((x) => x !== id) : [...(f.amenities ?? []), id],
                      })
                    }
                  >
                    <Icon name={AMENITY_ICON[id] ?? "check"} /> {amenityLabel(id).label}
                  </button>
                );
              })}
            </div>
            <span className="hint">{msg.mustHaveHint}</span>
          </fieldset>
        </div>

        <details
          className="more"
          ref={moreRef}
          open={moreOpen}
          onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            {msg.moreOptions} <span className="muted">{msg.moreOptionsHint}</span>
          </summary>

          <fieldset className="field">
            <legend className="label">{msg.propertyType}</legend>
            <div className="chips">
              {SEARCH_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="choice"
                  aria-pressed={f.types.includes(type)}
                  onClick={() =>
                    setF({ types: f.types.includes(type) ? f.types.filter((x) => x !== type) : [...f.types, type] })
                  }
                >
                  {t.listings.propertyTypes[type]}
                </button>
              ))}
            </div>
            <span className="hint">{f.types.length ? msg.otherTypesHint : msg.anyTypeHint}</span>
          </fieldset>

          <fieldset className="field">
            <legend className="label">{msg.slackQuestion}</legend>
            <div className="chips">
              {SLACKS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="choice"
                  aria-pressed={(f.slack ?? 0) === k}
                  onClick={() => p.setFilters(withBudget(f, f.budget ?? null, k))}
                >
                  {k ? `+${k}%` : msg.noSlack}
                </button>
              ))}
            </div>
          </fieldset>

          {chosenDefs.length > 0 && (
            <fieldset className="field">
              <legend className="label">{msg.walkingDistance}</legend>
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
                            {msg.radiusOption(meters(r), walkMin(r))}
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
              {msg.lineQuestion}
            </label>
            <div className="row">
              <div className="money-input line-input">
                <Icon name="bus" size={18} />
                <input
                  id="line"
                  value={line}
                  placeholder={msg.linePlaceholder}
                  onChange={(e) => setLine(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLine()}
                />
              </div>
              <button type="button" className="btn" disabled={lineBusy || !line.trim()} onClick={addLine}>
                {lineBusy ? <Spinner small /> : <Icon name="pin" />} {msg.showOnMap}
              </button>
            </div>
            <span className="hint">{lineMsg ?? msg.lineHint}</span>
          </div>

          <div className="grid3">
            <label className="field">
              <span className="label">{msg.bathrooms}</span>
              <select value={f.minBathrooms ?? 0} onChange={(e) => setF({ minBathrooms: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n ? msg.orMore(n) : msg.any}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">{msg.parking}</span>
              <select value={f.minParking ?? 0} onChange={(e) => setF({ minParking: Number(e.target.value) })}>
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    {n ? msg.orMore(n) : msg.any}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">{msg.minArea}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                placeholder={msg.any}
                value={f.minArea || ""}
                onChange={(e) => setF({ minArea: Number(e.target.value) || 0 })}
              />
            </label>
          </div>

          <fieldset className="field" ref={sourcesRef}>
            <legend className="label">{msg.whereToSearch}</legend>
            <SourcesPicker s={s} cityName={p.city?.name} />
          </fieldset>

          <label className="check">
            <input type="checkbox" checked={!!f.hideUnknown} onChange={() => setF({ hideUnknown: !f.hideUnknown })} />
            {msg.hideUnknown}
          </label>

          <div className="grid3">
            <label className="field">
              <span className="label">{msg.walkToStop(meters(s.params.maxWalkToStopM))}</span>
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
              <span className="label">{msg.listingsPerRegion}</span>
              <select value={s.maxPerRegion} onChange={(e) => s.setMaxPerRegion(Number(e.target.value))}>
                {[50, 100, 200, 300].map((n) => (
                  <option key={n} value={n}>
                    {msg.upTo(n)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <div className="setup-foot">
          <span className="hint">{!p.city ? msg.missingCity : !p.work ? msg.missingWork : msg.widensHint}</span>
          <button type="button" className="btn primary big" disabled={!ready || s.busy !== null} onClick={p.onFinish}>
            {msg.showListings} <Icon name="chevR" />
          </button>
        </div>
      </section>
    </div>
  );
}
