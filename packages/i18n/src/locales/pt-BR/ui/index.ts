import { app, filterBar, topBar } from "./app.js";
import { common, errors } from "./common.js";
import { linePopover, links, timetable, transit } from "./links.js";
import { legend, levels, map, mapSettings } from "./map.js";
import { detail, listing, preview, results } from "./results.js";
import { report } from "./report.js";
import { priorities, search, sources } from "./search.js";
import { setup } from "./setup.js";

/** Texts of the web app, grouped by screen. */
export const ui = {
  common,
  errors,
  app,
  topBar,
  filterBar,
  search,
  priorities,
  sources,
  setup,
  links,
  linePopover,
  timetable,
  transit,
  levels,
  legend,
  mapSettings,
  map,
  results,
  listing,
  preview,
  detail,
  report,
};
