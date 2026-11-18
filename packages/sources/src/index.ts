// Everything that comes from outside: OpenStreetMap, bus operators, portals and agencies, pasted links.
// Every outgoing call goes through http.ts (per-host pacing, retries, cache).
export { FEATURES, featureById, fetchFeaturePois, fetchPlaceNames } from "./features.js";
export { fetchBusStops, fetchRoutesNearWork } from "./transit.js";
export { fetchIntercity, type BusStation, type IntercityData } from "./intercity.js";
export { findBusLines, findBusLinesNear } from "./busline.js";
export { operatorById, operatorFor } from "./operators/index.js";
export type { TransitOperator } from "./operators/types.js";
export { resolveLink } from "./links.js";
export { discoverSources, portalSources } from "./listings/discovery.js";
export { searchListings } from "./listings/index.js";
export { cityAt, getCity, reverse, searchAddress, searchCities } from "./osm/nominatim.js";
export { DATA_DIR, useSharedCache, type SharedCache } from "./http.js";
