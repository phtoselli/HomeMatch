import { analysis, commute } from "./analysis.js";
import { api } from "./api.js";
import { features } from "./features.js";
import { links } from "./links.js";
import { sources } from "./sources.js";
import { format } from "./format.js";
import { listings } from "./listings.js";
import { regions } from "./regions.js";
import { transit } from "./transit.js";
import { ui } from "./ui/index.js";

/** Brazilian Portuguese catalog (the app's language). */
export const ptBR = { analysis, api, commute, features, format, links, listings, regions, sources, transit, ui };
