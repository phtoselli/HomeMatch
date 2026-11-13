import type { PlaceResult } from "../../shared/types.js";
import { emdec } from "./emdec.js";
import type { TransitOperator } from "./types.js";

// Cadastro de operadores por cidade. Para adicionar uma cidade: um arquivo com o adaptador + entrada aqui.
export const OPERATORS: TransitOperator[] = [emdec];

export function operatorFor(city?: Pick<PlaceResult, "osmId" | "name" | "stateCode"> | null): TransitOperator | undefined {
  if (!city?.name) return undefined;
  return OPERATORS.find((o) => o.serves(city));
}

export function operatorById(id: string): TransitOperator | undefined {
  return OPERATORS.find((o) => o.info.id === id);
}
