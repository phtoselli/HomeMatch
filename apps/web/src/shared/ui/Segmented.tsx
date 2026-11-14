import type { ReactNode } from "react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}

/** Escolha de uma opção entre poucas (botões lado a lado, o escolhido em destaque). */
export function Segmented<T extends string | number>({ options, value, onChange, label, className }: Props<T>) {
  return (
    <div className={className ? `seg ${className}` : "seg"} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
