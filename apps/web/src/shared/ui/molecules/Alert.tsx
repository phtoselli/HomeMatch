import type { ReactNode } from "react";
import { Icon } from "../atoms/Icon";

/** Highlighted error message (icon + text). */
export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div className="alert err" role="alert">
      <Icon name="alert" /> {children}
    </div>
  );
}
