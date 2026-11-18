import type { BBox, Listing } from "@homematch/contracts";

/** Mouse over a line (point on the map's screen); a click pins the popover. key null = left the line. */
export type LineHover = (key: string | null, at?: { x: number; y: number }, pin?: boolean) => void;

/** A pasted listing link: numbered pin. */
export type NumberedListing = Listing & { index: number };

/** Fit requested from the map; `key` changes on every request (to repeat the same rectangle). */
export type FitTarget = { bbox: BBox; key: number } | null;
