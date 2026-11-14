import type { City } from "../../shared/types";
import { money } from "../format";
import { Icon, type IconName } from "../icons";
import type { Filters, Params } from "../search";

export type Mode = "explore" | "links";

interface Props {
  city: City | null;
  workLabel?: string;
  params: Params;
  filters: Filters;
  mode: Mode;
  setMode: (m: Mode) => void;
  linksCount: number;
  setupOpen: boolean;
  onEdit: (step: number) => void;
}

/** Barra do topo: a busca resumida (cada parte abre o passo certo) e a troca entre imóveis e links. */
export function TopBar(p: Props) {
  const budget = p.filters.budget ? `~${money(p.filters.budget)}/mês` : "sem limite";
  const pills: { icon: IconName; label: string; value: string; step: number }[] = [
    { icon: "pin", label: "Cidade", value: p.city ? `${p.city.name}${p.city.stateCode ? `, ${p.city.stateCode}` : ""}` : "escolher", step: 0 },
    { icon: "brief", label: "Trabalho", value: p.workLabel ? p.workLabel.split(",")[0]! : "marcar", step: 0 },
    { icon: "clock", label: "Trajeto", value: `até ${p.params.maxCommuteMin} min`, step: 1 },
    { icon: "wallet", label: p.filters.basis === "rent" ? "Aluguel" : "Total", value: budget, step: 1 },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo"><Icon name="home" size={20} /></span>
        <span>HomeMatch</span>
      </div>
      <nav className="summary" aria-label="Sua busca">
        {pills.map((s) => (
          <button key={s.label} type="button" className="sumpill" onClick={() => p.onEdit(s.step)} title={`Editar ${s.label.toLowerCase()}`}>
            <Icon name={s.icon} size={15} />
            <span className="k">{s.label}</span>
            <span className="v">{s.value}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <div className="seg" role="group" aria-label="O que ver">
          <button type="button" aria-pressed={p.mode === "explore"} onClick={() => p.setMode("explore")}>Imóveis</button>
          <button type="button" aria-pressed={p.mode === "links"} onClick={() => p.setMode("links")}>
            Links e linhas{p.linksCount ? ` (${p.linksCount})` : ""}
          </button>
        </div>
        {!p.setupOpen && (
          <button type="button" className="btn" aria-label="Editar busca" onClick={() => p.onEdit(0)}>
            <Icon name="sliders" /> <span>Editar busca</span>
          </button>
        )}
      </div>
    </header>
  );
}
