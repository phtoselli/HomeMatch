import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Mensagem de erro em destaque (ícone + texto). */
export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div className="alert err" role="alert">
      <Icon name="alert" /> {children}
    </div>
  );
}
