import { Switch } from "../atoms/Switch";

interface Props {
  on: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}

/** A switch with its label and an optional hint underneath (settings lists). */
export function SwitchField({ on, label, hint, disabled, onChange }: Props) {
  return (
    <label className="ms-row" data-disabled={disabled || undefined}>
      <Switch checked={on && !disabled} disabled={disabled} onChange={onChange} />
      <span className="ms-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
