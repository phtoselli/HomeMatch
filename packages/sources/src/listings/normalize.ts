import type { AmenityId, PropertyType } from "@homematch/contracts";

// The patterns below match Brazilian listing text (Portuguese words), which is the data being parsed.

// Order = tie-break when two match at the same position ("casa de condomínio" before "casa").
const TYPE_PATTERNS: [PropertyType, RegExp][] = [
  ["studio", /studio|kitnet|kitchenette|loft|quitinete/],
  ["condo_house", /casa\s*(?:de|em)?\s*(?:condominio|vila)|casacondominio|sobrado\s*(?:de|em)\s*condominio/],
  ["apartment", /apartamento|apartment|cobertura|flat|duplex|triplex|garden/],
  ["house", /casa|sobrado|residence|house/],
];

/**
 * Maps each site's type label to a common type. The word that appears first wins:
 * in "Apartamento … na Vila Itapura, condomínio R$ 600" the type is apartment, not condo house.
 */
export function normalizeType(label: string): PropertyType {
  const s = label.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  let best: { type: PropertyType; at: number } | null = null;
  for (const [type, re] of TYPE_PATTERNS) {
    const at = s.search(re);
    if (at >= 0 && (!best || at < best.at)) best = { type, at };
  }
  return best?.type ?? "other";
}

/** "R$ 7.000" → 7000; "1.605,50" → 1605.5 (Brazilian format). undefined without a number. */
export function parseBRL(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const m = s.match(/\d[\d.]*(?:,\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** First integer in the text ("Quantidade de quartos 2" → 2; "82-90 m²" → 82). */
export function firstInt(s: string | undefined | null): number | undefined {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Amenities that can be read from the listing text (stable ids, used by the map filters). */
export const AMENITY_PATTERNS: [AmenityId, RegExp][] = [
  [
    "kitchen_cabinets",
    /\b(cozinha (americana )?(planejada|com (armarios?|gabinetes?)|mobiliada)|armarios? (planejados? )?(na|da|de|em) cozinha|gabinetes? (na|da|de) cozinha)\b/,
  ],
  [
    "wardrobe",
    /\b(guarda[- ]?roupas?|armarios? embutidos?|closets?|armarios? (planejados? )?(nos?|nas?|dos?|das?|em) (dois |tres )?(quartos?|dormitorios?|suites?)|(quartos?|dormitorios?|suites?) (planejad[oa]s?|com armarios?))\b/,
  ],
  ["sink", /\b(pias?|bancadas?|cubas?)\b/],
  ["furnished", /\b(semi[- ]?)?mobiliad[oa]s?\b/],
];

/** Listing text (title, description, item list) → amenity ids, without duplicates. */
export function detectAmenities(text: string | undefined | null): AmenityId[] {
  if (!text) return [];
  const s = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
  return AMENITY_PATTERNS.filter(([, re]) => re.test(s)).map(([id]) => id);
}
