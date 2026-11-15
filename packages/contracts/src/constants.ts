/**
 * Valores do contrato que o app e o domínio usam em tempo de execução, sem zod. Importe de
 * `@homematch/contracts/constants`: do índice, só tipos (`import type`), para o zod ficar no servidor.
 */

export const PROPERTY_TYPES = ["apartamento", "casa", "casa_condominio", "studio", "outro"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  casa_condominio: "Casa de condomínio",
  studio: "Studio / kitnet",
  outro: "Outro",
};

export const TRANSIT_MODES = ["bus", "trolleybus", "subway", "train", "light_rail", "tram", "monorail"] as const;
export type TransitMode = (typeof TRANSIT_MODES)[number];
