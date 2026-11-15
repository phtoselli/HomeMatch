import type { FeatureDef } from "@homematch/contracts";
import { IMPORTANCE, TRANSIT_CRITERION, meters, type Importance } from "@homematch/domain";
import { FEATURE_ICON, Icon, type IconName } from "@/shared/ui";
import { importanceOf, setImportance, type Priorities } from "../model/search";

interface Props {
  priorities: Priorities;
  setPriorities: (p: Priorities) => void;
  /** Lugares escolhidos (com o raio). */
  chosen: Record<string, number>;
  features: FeatureDef[];
}

const LEVELS: [Importance | 0, string][] = [
  [IMPORTANCE.main, "Principal"],
  [IMPORTANCE.important, "Importante"],
  [IMPORTANCE.nice, "Bom ter"],
];

/**
 * O que pesa mais na escolha da região: o transporte até o trabalho e cada lugar que a pessoa quer perto.
 * Só um é o principal; ele decide se a região é "boa" (atingiu) ou só "ok" (não atingiu).
 */
export function PrioritiesPicker({ priorities, setPriorities, chosen, features }: Props) {
  const ids = [TRANSIT_CRITERION, ...Object.keys(chosen)];
  const rows: { id: string; icon: IconName; label: string; detail: string }[] = [
    { id: TRANSIT_CRITERION, icon: "bus", label: "Transporte até o trabalho", detail: "ônibus, trem ou a pé" },
    ...features
      .filter((d) => d.id in chosen)
      .map((d) => ({
        id: d.id,
        icon: FEATURE_ICON[d.id] ?? ("pin" as IconName),
        label: d.label.split(" / ")[0]!,
        detail: `a até ${meters(chosen[d.id]!)}`,
      })),
  ];
  const set = (id: string, v: Importance | 0) => setPriorities(setImportance(priorities, ids, id, v));

  return (
    <div className="prio-list">
      {rows.map((r) => {
        const v = importanceOf(priorities, r.id);
        const options = r.id === TRANSIT_CRITERION ? [...LEVELS, [0, "Não uso"] as [0, string]] : LEVELS;
        return (
          <div key={r.id} className="prio-row" data-main={v === IMPORTANCE.main || undefined}>
            <span className="prio-label">
              <Icon name={r.icon} size={16} /> {r.label} <span className="muted">{r.detail}</span>
            </span>
            <div className="seg small" role="group" aria-label={`Importância: ${r.label}`}>
              {options.map(([n, label]) => (
                <button key={n} type="button" aria-pressed={v === n} onClick={() => set(r.id, n)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
