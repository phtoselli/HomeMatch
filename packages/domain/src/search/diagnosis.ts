import type { Listing } from "@homematch/contracts";
import { priceOf, type Filters } from "./criteria.js";

/** Por que a busca voltou vazia: o que existe logo acima do teto e em outros tipos. */
export interface Diagnosis {
  ceiling: number | null;
  /** Mesmo tipo e quartos, até ~60% acima do teto: quantos e o mais barato. */
  sameCount: number;
  cheapestSame?: number;
  /** Qualquer tipo e número de quartos, dentro do teto. */
  others: number;
  othersCheapest?: number;
}

export function diagnose(same: Listing[], any: Listing[], f: Filters): Diagnosis {
  const prices = (ls: Listing[]) => ls.map((l) => priceOf(l, f.basis)).filter((p) => p > 0);
  const ceiling = f.priceMax ?? null;
  const sp = prices(same);
  const ap = prices(any).filter((p) => ceiling == null || p <= ceiling);
  return {
    ceiling,
    sameCount: sp.length,
    cheapestSame: sp.length ? Math.min(...sp) : undefined,
    others: ap.length,
    othersCheapest: ap.length ? Math.min(...ap) : undefined,
  };
}
