const levels = { excellent: "Excelente", good: "Boa", ok: "Ok" };

/** Region levels and region names. */
export const regions = {
  levels,
  fallbackCity: "Região",
  /** "Paulínia, zona norte". */
  citySide: (city: string, side: string) => `${city}, ${side}`,
  sides: {
    center: "centro",
    north: "zona norte",
    south: "zona sul",
    east: "zona leste",
    west: "zona oeste",
    northeast: "zona nordeste",
    northwest: "zona noroeste",
    southeast: "zona sudeste",
    southwest: "zona sudoeste",
  },
};
