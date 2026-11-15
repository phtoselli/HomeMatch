import type { BBox, Listing } from "@homematch/contracts";

/** Mouse sobre uma linha (ponto na tela do mapa); clique fixa o popover. key null = saiu da linha. */
export type LineHover = (key: string | null, at?: { x: number; y: number }, pin?: boolean) => void;

/** Anúncio colado em "Meus links": pin com número. */
export type NumberedListing = Listing & { index: number };

/** Enquadramento pedido ao mapa; `key` muda a cada pedido (para repetir o mesmo retângulo). */
export type FitTarget = { bbox: BBox; key: number } | null;
