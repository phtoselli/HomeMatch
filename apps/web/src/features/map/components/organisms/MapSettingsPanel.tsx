import { useState } from "react";
import { useEscape } from "@/shared/hooks/useEscape";
import type { FeatureDef, RegionLevel } from "@homematch/contracts";
import { type LineSummary, lineRoleLabel } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { shortLabel } from "@/shared/lib/format";
import { CloseButton, FEATURE_ICON, Icon, Switch, SwitchField as Toggle } from "@/shared/ui";
import { DEFAULT_MAP_SETTINGS, type MapSettings } from "../../model/settings";

interface Props {
  settings: MapSettings;
  setSettings: (s: MapSettings) => void;
  /** Places requested in the search (the ones shown on the map). */
  features: FeatureDef[];
  /** Minimum level of the regions shown (also applies to the listing list). */
  minLevel: RegionLevel;
  setMinLevel: (l: RegionLevel) => void;
  hasAnalysis: boolean;
  myLinesCount: number;
  /** Lines on the map (from the analysis and those the user added), one per number. */
  lines: LineSummary[];
  myLinksCount: number;
  onClose: () => void;
}

const msg = t.ui.mapSettings;

const LEVELS: [RegionLevel, string][] = [
  ["ok", t.ui.levels.all],
  ["good", t.ui.levels.goodOrBetter],
  ["excellent", t.ui.levels.excellentOnly],
];

/** Map settings: what it shows (region levels, lines, places, listings…). */
export function MapSettingsPanel(p: Props) {
  const s = p.settings;
  const set = (patch: Partial<MapSettings>) => p.setSettings({ ...s, ...patch });
  useEscape(p.onClose);

  const noAnalysis = p.hasAnalysis ? undefined : msg.afterSearch;
  const [lineQuery, setLineQuery] = useState("");
  const q = lineQuery.trim().toLowerCase();
  const lines = q
    ? p.lines.filter((l) =>
        `${l.ref ?? ""} ${l.name} ${l.directions.map((d) => `${d.from ?? ""} ${d.to ?? ""}`).join(" ")}`
          .toLowerCase()
          .includes(q),
      )
    : p.lines;
  const hiddenSet = new Set(s.hiddenLines);
  const shownCount = p.lines.filter((l) => !hiddenSet.has(l.key)).length;
  const groupOn = (l: LineSummary) => (l.roles.includes("mine") && s.myLines) || (l.roles.includes("work") && s.routes);
  const toggleLine = (key: string) =>
    set({ hiddenLines: hiddenSet.has(key) ? s.hiddenLines.filter((x) => x !== key) : [...s.hiddenLines, key] });
  return (
    <div className="map-settings" role="dialog" aria-label={msg.title}>
      <div className="ms-head">
        <b>{msg.heading}</b>
        <CloseButton onClick={p.onClose} />
      </div>

      <section className="ms-sec">
        <h3>{msg.regions}</h3>
        <Toggle on={s.cells} label={msg.regionLevels} hint={noAnalysis} onChange={(v) => set({ cells: v })} />
        <div className="seg small ms-seg" role="group" aria-label={t.ui.levels.whichRegions}>
          {LEVELS.map(([l, label]) => (
            <button key={l} type="button" aria-pressed={p.minLevel === l} onClick={() => p.setMinLevel(l)}>
              {label}
            </button>
          ))}
        </div>
        <p className="ms-hint">{msg.levelsHint}</p>
        <Toggle on={s.badges} label={msg.regionNames} hint={noAnalysis} onChange={(v) => set({ badges: v })} />
      </section>

      <section className="ms-sec">
        <h3>{msg.buses}</h3>
        <Toggle
          on={s.routes}
          label={msg.workLines}
          hint={noAnalysis ?? msg.workLinesHint}
          onChange={(v) => set({ routes: v })}
        />
        <Toggle
          on={s.myLines}
          label={msg.myLines}
          hint={p.myLinesCount ? msg.onMap(p.myLinesCount) : msg.noLinesYet}
          onChange={(v) => set({ myLines: v })}
        />
        <Toggle on={s.stops} label={msg.lineStops} disabled={!s.myLines} onChange={(v) => set({ stops: v })} />
        {p.lines.length > 0 && (
          <div className="ms-lines">
            <div className="ms-lines-head">
              <span>{msg.linesShown(shownCount, p.lines.length)}</span>
              <span>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => set({ hiddenLines: s.hiddenLines.filter((k) => !lines.some((l) => l.key === k)) })}
                >
                  {msg.all}
                </button>
                {" · "}
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => set({ hiddenLines: [...new Set([...s.hiddenLines, ...lines.map((l) => l.key)])] })}
                >
                  {msg.none}
                </button>
              </span>
            </div>
            {p.lines.length > 6 && (
              <input
                className="ms-search"
                type="search"
                placeholder={msg.filterLines}
                value={lineQuery}
                onChange={(e) => setLineQuery(e.target.value)}
              />
            )}
            <ul className="ms-line-list">
              {lines.map((l) => {
                const dest = l.directions.map((d) => d.to).filter(Boolean)[0];
                return (
                  <li key={l.key}>
                    <label className="ms-line" data-disabled={!groupOn(l) || undefined}>
                      <Switch checked={!hiddenSet.has(l.key)} onChange={() => toggleLine(l.key)} />
                      <span className="line-badge" style={{ background: l.color }}>
                        {l.ref ?? "•"}
                      </span>
                      <span className="ms-label">
                        {l.ref && l.name === t.transit.lineName(l.ref) && dest ? msg.towards(dest) : l.name}
                        <small>{lineRoleLabel(l)}</small>
                      </span>
                    </label>
                  </li>
                );
              })}
              {!lines.length && <li className="ms-hint">{msg.noLineMatch(lineQuery)}</li>}
            </ul>
          </div>
        )}
      </section>

      <section className="ms-sec">
        <h3>{msg.places}</h3>
        <Toggle
          on={s.pois}
          label={msg.showPlaces}
          hint={noAnalysis ?? (p.features.length ? undefined : msg.noPlacesChosen)}
          onChange={(v) => set({ pois: v })}
        />
        {p.features.length > 0 && (
          <div className="ms-chips">
            {p.features.map((f) => {
              const on = !s.hiddenPois.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className="fchip toggle"
                  aria-pressed={on}
                  disabled={!s.pois}
                  onClick={() =>
                    set({ hiddenPois: on ? [...s.hiddenPois, f.id] : s.hiddenPois.filter((x) => x !== f.id) })
                  }
                >
                  <Icon name={FEATURE_ICON[f.id] ?? "pin"} size={14} /> {shortLabel(f.label)}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="ms-sec">
        <h3>{msg.listings}</h3>
        <Toggle on={s.listings} label={msg.searchListings} onChange={(v) => set({ listings: v })} />
        <Toggle
          on={s.myLinks}
          label={msg.myLinks}
          hint={p.myLinksCount ? msg.onMap(p.myLinksCount) : undefined}
          onChange={(v) => set({ myLinks: v })}
        />
      </section>

      <section className="ms-sec">
        <h3>{msg.map}</h3>
        <Toggle on={s.boundary} label={msg.cityBoundary} onChange={(v) => set({ boundary: v })} />
        <Toggle on={s.legend} label={t.ui.legend.legend} onChange={(v) => set({ legend: v })} />
      </section>

      <button type="button" className="linkbtn ms-reset" onClick={() => p.setSettings(DEFAULT_MAP_SETTINGS)}>
        {msg.restoreDefaults}
      </button>
    </div>
  );
}
