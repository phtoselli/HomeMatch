/**
 * Contract values the app and the domain need at runtime, without zod. Import them from
 * `@homematch/contracts/constants`; from the package index, import types only, so zod stays on the server.
 */

export const PROPERTY_TYPES = ["apartment", "house", "condo_house", "studio", "other"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const TRANSIT_MODES = ["bus", "trolleybus", "subway", "train", "light_rail", "tram", "monorail"] as const;
export type TransitMode = (typeof TRANSIT_MODES)[number];

/** Region levels, from weakest to best. */
export const REGION_LEVELS = ["ok", "good", "excellent"] as const;
export type RegionLevel = (typeof REGION_LEVELS)[number];

/** How a cell reaches work: on foot, on a mapped line, or on an estimated bus (no mapped line). */
export const TRAVEL_KINDS = ["walk", "transit", "estimated"] as const;
export type TravelKind = (typeof TRAVEL_KINDS)[number];

/** Amenities detected in the listing text. */
export const AMENITY_IDS = ["kitchen_cabinets", "wardrobe", "sink", "furnished"] as const;
export type AmenityId = (typeof AMENITY_IDS)[number];
