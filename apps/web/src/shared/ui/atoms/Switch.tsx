import s from "./Switch.module.css";

interface Props {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/** On/off toggle (a checkbox styled as a switch). Use inside a <label> with the text. */
export function Switch({ checked, onChange, disabled, ...aria }: Props) {
  return (
    <input
      type="checkbox"
      className={s.switch}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      {...aria}
    />
  );
}
