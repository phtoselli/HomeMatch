import type { StoreApi } from "zustand";

// Preferências salvas no navegador (só conveniência: a busca volta como estava ao recarregar).
// Cada campo fica na sua própria chave "mapa-aluguel:<nome>", as mesmas das versões anteriores:
// quem já usava o app não perde favoritos, filtros nem linhas salvas.

const PREFIX = "mapa-aluguel:";

export function readSaved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeSaved(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* cheio ou bloqueado: segue sem salvar */
  }
}

/** Apaga tudo o que o app guardou neste navegador (busca, prioridades, favoritos, links, linhas e mapa). */
export function clearSaved(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* bloqueado: nada a apagar */
  }
}

/** Grava os campos escolhidos do store sempre que mudam. `keys` diz a chave de cada campo. */
export function persistFields<S>(store: StoreApi<S>, keys: Partial<Record<keyof S, string>>): void {
  store.subscribe((s, prev) => {
    for (const [field, key] of Object.entries(keys) as [keyof S, string][]) {
      if (s[field] !== prev[field]) writeSaved(key, s[field]);
    }
  });
}
