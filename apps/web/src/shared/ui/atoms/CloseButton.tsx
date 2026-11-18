import { Icon } from "./Icon";
import s from "./CloseButton.module.css";
import { t } from "@homematch/i18n";

/** The "x" that closes panels, popovers and modals. */
export function CloseButton({
  onClick,
  size = 16,
  label = t.ui.common.close,
}: {
  onClick: () => void;
  size?: number;
  label?: string;
}) {
  return (
    <button type="button" className={s.close} aria-label={label} onClick={onClick}>
      <Icon name="x" size={size} />
    </button>
  );
}
