import type { SortKey } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { Segmented } from "@/shared/ui";

const SORTS = ["match", "price", "commute"] as const satisfies readonly SortKey[];

/** List order (match, price, commute). */
export function SortPicker({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  return (
    <Segmented
      className="small"
      label={t.ui.results.sort}
      value={value}
      onChange={onChange}
      options={SORTS.map((k) => ({ value: k, label: t.ui.results.sorts[k] }))}
    />
  );
}
