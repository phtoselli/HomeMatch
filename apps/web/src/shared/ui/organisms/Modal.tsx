import type { ReactNode } from "react";
import { useEscape } from "../../hooks/useEscape";
import s from "./Modal.module.css";

interface Props {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** Dialog over the screen: closes on Esc and on outside click. */
export function Modal({ label, onClose, className, children }: Props) {
  useEscape(onClose);
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        className={className ? `${s.modal} ${className}` : s.modal}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
