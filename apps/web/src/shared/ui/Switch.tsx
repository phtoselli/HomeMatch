import s from "./Switch.module.css";

interface Props {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/** Liga/desliga (checkbox com cara de chave). Use dentro de um <label> com o texto. */
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
