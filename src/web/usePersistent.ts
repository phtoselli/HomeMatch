import { useEffect, useState } from "react";

/** useState salvo no localStorage (só conveniência: a busca volta como estava ao recarregar). */
export function usePersistent<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`mapa-aluguel:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`mapa-aluguel:${key}`, JSON.stringify(v));
    } catch {
      /* cheio ou bloqueado: segue sem salvar */
    }
  }, [key, v]);
  return [v, setV];
}
