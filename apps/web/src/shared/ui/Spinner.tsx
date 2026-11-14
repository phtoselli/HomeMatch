import s from "./Spinner.module.css";

/** Indicador de carregamento. `small` para dentro de textos e botões. */
export function Spinner({ small = false }: { small?: boolean }) {
  return <span className={small ? `${s.spinner} ${s.small}` : s.spinner} role="status" aria-label="Carregando" />;
}
