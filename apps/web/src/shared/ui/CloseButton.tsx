import { Icon } from "./Icon";
import s from "./CloseButton.module.css";

/** O "x" de fechar painéis, popovers e modais. */
export function CloseButton({
  onClick,
  size = 16,
  label = "Fechar",
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
