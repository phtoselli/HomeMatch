import type { FeatureDef } from "@homematch/contracts";
import { IMPORTANCE, TRANSIT_CRITERION, meters, type Importance } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { shortLabel } from "@/shared/lib/format";
import { FEATURE_ICON, Icon, type IconName } from "@/shared/ui";
import { importanceOf, setImportance, type Priorities } from "../../model/search";

interface Props {
  priorities: Priorities;
  setPriorities: (p: Priorities) => void;
  /** Chosen places (with their radius). */
  chosen: Record<string, number>;
  features: FeatureDef[];
}

const msg = t.ui.priorities;

const LEVELS: [Importance | 0, string][] = [
  [IMPORTANCE.main, msg.main],
  [IMPORTANCE.important, msg.important],
  [IMPORTANCE.nice, msg.nice],
];

/**
 * What weighs most when choosing a region: transit to work and each place the user wants nearby.
 * Only one is the main one; it decides whether a region is "good" (met) or just "ok" (not met).
 */
export function PrioritiesPicker({ priorities, setPriorities, chosen, features }: Props) {
  const ids = [TRANSIT_CRITERION, ...Object.keys(chosen)];
  const rows: { id: string; icon: IconName; label: string; detail: string }[] = [
    { id: TRANSIT_CRITERION, icon: "bus", label: msg.transit, detail: msg.transitDetail },
    ...features
      .filter((d) => d.id in chosen)
      .map((d) => ({
        id: d.id,
        icon: FEATURE_ICON[d.id] ?? ("pin" as IconName),
        label: shortLabel(d.label),
        detail: msg.within(meters(chosen[d.id]!)),
      })),
  ];
  const set = (id: string, v: Importance | 0) => setPriorities(setImportance(priorities, ids, id, v));

  return (
    <div className="prio-list">
      {rows.map((r) => {
        const v = importanceOf(priorities, r.id);
        const options = r.id === TRANSIT_CRITERION ? [...LEVELS, [0, msg.notUsed] as [0, string]] : LEVELS;
        return (
          <div key={r.id} className="prio-row" data-main={v === IMPORTANCE.main || undefined}>
            <span className="prio-label">
              <Icon name={r.icon} size={16} /> {r.label} <span className="muted">{r.detail}</span>
            </span>
            <div className="seg small" role="group" aria-label={msg.importanceOf(r.label)}>
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
