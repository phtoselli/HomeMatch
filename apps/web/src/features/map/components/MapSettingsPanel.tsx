import { useState } from "react";
import { useEscape } from "@/shared/hooks/useEscape";
import type { FeatureDef, RegionLevel } from "@homematch/contracts";
import type { LineSummary } from "@homematch/domain";
import { CloseButton, FEATURE_ICON, Icon, Switch } from "@/shared/ui";
import { DEFAULT_MAP_SETTINGS, type MapSettings } from "../model/settings";

interface Props {
  settings: MapSettings;
  setSettings: (s: MapSettings) => void;
  /** Lugares pedidos na busca (os que aparecem no mapa). */
  features: FeatureDef[];
  /** Nível mínimo das regiões mostradas (vale também para a lista de imóveis). */
  minLevel: RegionLevel;
  setMinLevel: (l: RegionLevel) => void;
  hasAnalysis: boolean;
  myLinesCount: number;
  /** Linhas no mapa (da análise e as que você adicionou), uma por número. */
  lines: LineSummary[];
  myLinksCount: number;
  onClose: () => void;
}

const LEVELS: [RegionLevel, string][] = [
  ["ok", "Todas"],
  ["boa", "Boa ou melhor"],
  ["excelente", "Só excelentes"],
];

function Toggle({
  on,
  label,
  hint,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="ms-row" data-disabled={disabled || undefined}>
      <Switch checked={on && !disabled} disabled={disabled} onChange={onChange} />
      <span className="ms-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

/** Configurações do mapa: o que ele mostra (nota das regiões, linhas, lugares, imóveis…). */
export function MapSettingsPanel(p: Props) {
  const s = p.settings;
  const set = (patch: Partial<MapSettings>) => p.setSettings({ ...s, ...patch });
  useEscape(p.onClose);

  const noAnalysis = p.hasAnalysis ? undefined : "aparece depois da busca";
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
    <div className="map-settings" role="dialog" aria-label="Configurações do mapa">
      <div className="ms-head">
        <b>O que mostrar no mapa</b>
        <CloseButton onClick={p.onClose} />
      </div>

      <section className="ms-sec">
        <h3>Regiões</h3>
        <Toggle on={s.cells} label="Nível das regiões" hint={noAnalysis} onChange={(v) => set({ cells: v })} />
        <div className="seg small ms-seg" role="group" aria-label="Quais regiões mostrar">
          {LEVELS.map(([l, label]) => (
            <button key={l} type="button" aria-pressed={p.minLevel === l} onClick={() => p.setMinLevel(l)}>
              {label}
            </button>
          ))}
        </div>
        <p className="ms-hint">
          Excelente: a sua prioridade principal e quase todo o resto. Boa: a principal. Ok: alguma coisa, mas não a
          principal. Vale também para os imóveis da lista.
        </p>
        <Toggle
          on={s.badges}
          label="Nomes das melhores regiões"
          hint={noAnalysis}
          onChange={(v) => set({ badges: v })}
        />
      </section>

      <section className="ms-sec">
        <h3>Ônibus</h3>
        <Toggle
          on={s.routes}
          label="Linhas que levam ao trabalho"
          hint={noAnalysis ?? "as que a análise usou"}
          onChange={(v) => set({ routes: v })}
        />
        <Toggle
          on={s.myLines}
          label="Linhas que você adicionou"
          hint={p.myLinesCount ? `${p.myLinesCount} no mapa` : "nenhuma ainda (Mais opções → linha de ônibus)"}
          onChange={(v) => set({ myLines: v })}
        />
        <Toggle on={s.stops} label="Pontos dessas linhas" disabled={!s.myLines} onChange={(v) => set({ stops: v })} />
        {p.lines.length > 0 && (
          <div className="ms-lines">
            <div className="ms-lines-head">
              <span>
                {shownCount} de {p.lines.length} linhas no mapa
              </span>
              <span>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => set({ hiddenLines: s.hiddenLines.filter((k) => !lines.some((l) => l.key === k)) })}
                >
                  Todas
                </button>
                {" · "}
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => set({ hiddenLines: [...new Set([...s.hiddenLines, ...lines.map((l) => l.key)])] })}
                >
                  Nenhuma
                </button>
              </span>
            </div>
            {p.lines.length > 6 && (
              <input
                className="ms-search"
                type="search"
                placeholder="Filtrar: número, bairro…"
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
                        {l.name !== `Linha ${l.ref}` ? l.name : dest ? `Sentido ${dest}` : l.name}
                        <small>
                          {l.roles.includes("work") ? "leva ao trabalho" : ""}
                          {l.roles.length > 1 ? " · " : ""}
                          {l.roles.includes("mine") ? "você adicionou" : ""}
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
              {!lines.length && <li className="ms-hint">Nenhuma linha com "{lineQuery}".</li>}
            </ul>
          </div>
        )}
      </section>

      <section className="ms-sec">
        <h3>Lugares perto de casa</h3>
        <Toggle
          on={s.pois}
          label="Mostrar lugares"
          hint={noAnalysis ?? (p.features.length ? undefined : "nenhum escolhido na busca")}
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
                  <Icon name={FEATURE_ICON[f.id] ?? "pin"} size={14} /> {f.label.split(" / ")[0]}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="ms-sec">
        <h3>Imóveis</h3>
        <Toggle on={s.listings} label="Imóveis da busca" onChange={(v) => set({ listings: v })} />
        <Toggle
          on={s.myLinks}
          label="Meus links"
          hint={p.myLinksCount ? `${p.myLinksCount} no mapa` : undefined}
          onChange={(v) => set({ myLinks: v })}
        />
      </section>

      <section className="ms-sec">
        <h3>Mapa</h3>
        <Toggle on={s.boundary} label="Limite da cidade" onChange={(v) => set({ boundary: v })} />
        <Toggle on={s.legend} label="Legenda" onChange={(v) => set({ legend: v })} />
      </section>

      <button type="button" className="linkbtn ms-reset" onClick={() => p.setSettings(DEFAULT_MAP_SETTINGS)}>
        Voltar ao padrão
      </button>
    </div>
  );
}
