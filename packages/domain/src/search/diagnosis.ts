import type { Listing } from "@homematch/contracts";
import { priceOf, type Filters } from "./criteria.js";

/** Why the search came back empty: what exists just above the price cap and in other property types. */
export interface Diagnosis {
  ceiling: number | null;
  /** Same type and bedrooms, up to ~60% above the cap: how many and the cheapest. */
  sameCount: number;
  cheapestSame?: number;
  /** Any type and number of bedrooms, within the cap. */
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
