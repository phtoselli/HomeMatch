const propertyTypes = {
  apartment: "Apartamento",
  house: "Casa",
  condo_house: "Casa de condomínio",
  studio: "Studio / kitnet",
  other: "Outro",
};

const amenities = {
  kitchen_cabinets: { label: "Armário na cozinha", short: "Armário cozinha" },
  wardrobe: { label: "Guarda-roupa no quarto", short: "Guarda-roupa" },
  sink: { label: "Pia / bancada", short: "Pia" },
  furnished: { label: "Mobiliado", short: "Mobiliado" },
};

/** Listings: property types, amenities and what does not match the request. */
export const listings = {
  propertyTypes,
  amenities,
  room: "Quarto",
  /** "Casa em Cambuí" (or just the type when the place is unknown). */
  titleIn: (type: string, place?: string) => (place ? `${type} em ${place}` : type),
  misses: {
    overCap: (amount: string) => `${amount} acima do teto`,
    bedrooms: (n: number) => (n ? `${n} ${n === 1 ? "quarto" : "quartos"}` : "Sem quarto separado"),
    outsideRegions: "Fora das regiões recomendadas",
    placeFar: (place: string) => `${place} longe`,
    placeAt: (place: string, distance: string) => `${place} a ${distance}`,
    without: (item: string) => `Sem ${item.toLowerCase()}`,
  },
};
