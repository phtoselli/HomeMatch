// Tudo que vem de fora: OpenStreetMap, operador de ônibus, portais e imobiliárias, links colados.
// Cada chamada externa passa por http.ts (ritmo por host, novas tentativas, cache).
export { FEATURES, featureById, fetchFeaturePois, fetchPlaceNames } from "./features.js";
export { fetchBusStops, fetchRoutesNearWork } from "./transit.js";
export { findBusLines, findBusLinesNear } from "./busline.js";
export { operatorById, operatorFor } from "./operators/index.js";
export type { TransitOperator } from "./operators/types.js";
export { resolveLink } from "./links.js";
export { discoverSources, portalSources } from "./listings/discovery.js";
export { searchListings } from "./listings/index.js";
export { getCity, reverse, searchAddress, searchCities } from "./osm/nominatim.js";
export { DATA_DIR } from "./http.js";
