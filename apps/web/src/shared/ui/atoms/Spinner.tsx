import s from "./Spinner.module.css";
import { t } from "@homematch/i18n";

/** Loading indicator. `small` for use inside text and buttons. */
export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? `${s.spinner} ${s.small}` : s.spinner} role="status" aria-label={t.ui.common.loading} />
  );
}
