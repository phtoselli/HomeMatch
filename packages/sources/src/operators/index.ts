import type { PlaceResult } from "@homematch/contracts";
import { emdec } from "./emdec.js";
import type { TransitOperator } from "./types.js";

// Registry of operators per city. To add a city: a file with the adapter + an entry here.
export const OPERATORS: TransitOperator[] = [emdec];

export function operatorFor(
  city?: Pick<PlaceResult, "osmId" | "name" | "stateCode"> | null,
): TransitOperator | undefined {
  if (!city?.name) return undefined;
  return OPERATORS.find((o) => o.serves(city));
}

export function operatorById(id: string): TransitOperator | undefined {
  return OPERATORS.find((o) => o.info.id === id);
}
