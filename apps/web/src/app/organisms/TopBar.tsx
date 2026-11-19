import type { ReactNode } from "react";
import type { City } from "@homematch/contracts";
import { money, type Filters } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { Icon, type IconName, Segmented } from "@/shared/ui";

import type { Mode } from "../model/shell";

interface Props {
  city: City | null;
  workLabel?: string;
  /** Main priority (transit or a place). */
  mainLabel: string;
  filters: Filters;
  mode: Mode;
  setMode: (m: Mode) => void;
  linksCount: number;
  setupOpen: boolean;
  onEdit: (step: number) => void;
  /** Erases everything saved and goes back to the defaults. */
  onReset: () => void;
  /** "Export PDF" action (from the report feature). */
  exportButton?: ReactNode;
}

const msg = t.ui.topBar;

/** Top bar: the search summary (each part opens the right step) and the switch between listings and links. */
export function TopBar(p: Props) {
  const budget = p.filters.budget ? msg.budgetPerMonth(money(p.filters.budget)) : msg.noLimit;
  const pills: { icon: IconName; label: string; value: string; step: number }[] = [
    {
      icon: "pin",
      label: msg.city,
      value: p.city ? `${p.city.name}${p.city.stateCode ? `, ${p.city.stateCode}` : ""}` : msg.choose,
      step: 0,
    },
    { icon: "brief", label: msg.work, value: p.workLabel ? p.workLabel.split(",")[0]! : msg.mark, step: 0 },
    { icon: "star", label: msg.priority, value: p.mainLabel, step: 1 },
    { icon: "wallet", label: p.filters.basis === "rent" ? msg.rent : msg.total, value: budget, step: 1 },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">
          <Icon name="home" size={20} />
        </span>
        <span>HomeMatch</span>
      </div>
      <nav className="summary" aria-label={msg.yourSearch}>
        {pills.map((s) => (
          <button
            key={s.label}
            type="button"
            className="sumpill"
            onClick={() => p.onEdit(s.step)}
            title={msg.edit(s.label)}
          >
            <Icon name={s.icon} size={15} />
            <span className="k">{s.label}</span>
            <span className="v">{s.value}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <Segmented
          className="mode-nav"
          label={msg.whatToSee}
          value={p.mode}
          onChange={p.setMode}
          options={[
            { value: "explore", label: msg.listings },
            { value: "links", label: msg.linksAndLines(p.linksCount) },
          ]}
        />
        {p.exportButton}
        <button type="button" className="btn ghost" aria-label={msg.reset} title={msg.resetHint} onClick={p.onReset}>
          <Icon name="refresh" /> <span>{msg.reset}</span>
        </button>
        {!p.setupOpen && (
          <button type="button" className="btn" aria-label={msg.editSearch} onClick={() => p.onEdit(0)}>
            <Icon name="sliders" /> <span>{msg.editSearch}</span>
          </button>
        )}
      </div>
    </header>
  );
}
