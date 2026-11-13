import type { Listing, ListingFilters } from "./types.js";

/**
 * O anúncio atende ao que a pessoa procura? Usado no servidor (depois de cada site) e no mapa.
 * Comodidades ficam de fora: dependem de "sem informação" e são tratadas no navegador.
 */
export function matchesFilters(l: Listing, f: ListingFilters | undefined): boolean {
  if (!f) return true;
  const price = f.basis === "rent" ? l.rent : l.total;
  if (f.types.length && !f.types.includes(l.type)) return false;
  if (f.priceMin != null && price < f.priceMin) return false;
  if (f.priceMax != null && price > f.priceMax) return false;
  if (f.minBedrooms && (l.bedrooms ?? 0) < f.minBedrooms) return false;
  if (f.minBathrooms && (l.bathrooms ?? 0) < f.minBathrooms) return false;
  if (f.minParking && (l.parking ?? 0) < f.minParking) return false;
  if (f.minArea && (l.area ?? 0) < f.minArea) return false;
  return true;
}

/** Filtros do mapa: os do imóvel + comodidades exigidas (com "sem informação" tratado à parte). */
export interface MapFilters extends ListingFilters {
  /** Ids de Listing.amenities exigidos ("armario_cozinha", "armario_quarto", "pia"). */
  amenities?: string[];
  /** Esconde anúncios que não dizem nada sobre as comodidades exigidas. */
  hideUnknown?: boolean;
}

/** true/false quando o anúncio diz algo; undefined quando não há informação. Mobiliado conta como tendo armários. */
export function hasAmenity(l: Listing, id: string): boolean | undefined {
  if (!l.amenities) return undefined;
  if (l.amenities.includes(id)) return true;
  if (id.startsWith("armario_") && l.amenities.includes("mobiliado")) return true;
  // Só "mobiliado" (lista do QuintoAndar, sem descrição): não dá para dizer que falta pia.
  if (l.amenities.length === 1 && l.amenities[0] === "mobiliado") return undefined;
  return false;
}

/** 0 = tem tudo que foi pedido, 1 = sem informação, 2 = falta algo. */
export function amenityRank(l: Listing, wanted: string[]): number {
  let rank = 0;
  for (const id of wanted) {
    const h = hasAmenity(l, id);
    if (h === false) return 2;
    if (h === undefined) rank = 1;
  }
  return rank;
}

/** O que aparece no mapa e na lista. */
export function applyFilters<T extends Listing>(list: T[], f: MapFilters): T[] {
  const wanted = f.amenities ?? [];
  return list.filter((l) => {
    if (!matchesFilters(l, f)) return false;
    if (wanted.length) {
      const r = amenityRank(l, wanted);
      if (r === 2 || (r === 1 && f.hideUnknown)) return false;
    }
    return true;
  });
}
