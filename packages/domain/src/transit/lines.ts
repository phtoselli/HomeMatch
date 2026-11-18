import type { BusLine, LatLng, RouteKind, TransitMode, TransitRoute } from "@homematch/contracts";
import { LOCALE_TAG, t } from "@homematch/i18n";
import { distance } from "../geo.js";

/** A bus line the way people think of it: the number, with both directions together. */
export interface LineSummary {
  /** Line key (the number; without one, the id). It is what toggles the line on the map. */
  key: string;
  ref?: string;
  name: string;
  color: string;
  mode: TransitMode;
  operator?: string;
  website?: string;
  directions: { id: string; from?: string; to?: string; stops: number }[];
  /** work = the analysis uses it to reach work; mine = the user added it. */
  roles: ("work" | "mine")[];
  /** Role in the analysis (the strongest among its directions): near work, intercity… */
  kind?: RouteKind;
  /** Id to request the timetable ("emdec:353"), when the operator publishes one. */
  timetableId?: string;
}

export const lineKey = (x: { ref?: string; id: string }) => x.ref ?? x.id;

const generic = (name: string, ref?: string) => !name || (!!ref && name === t.transit.lineName(ref));
const timetableOf = (id: string) =>
  id
    .match(/^([a-z]+):([^:]+)/i)
    ?.slice(1, 3)
    .join(":");

/** Merges the analysis lines and the ones the user added, by number. */
export function summarizeLines(routes: TransitRoute[], mine: BusLine[]): LineSummary[] {
  const byKey = new Map<string, LineSummary>();
  const get = (x: { id: string; ref?: string; name: string; color: string; mode: TransitMode; operator?: string }) => {
    const key = lineKey(x);
    let s = byKey.get(key);
    if (!s) {
      s = {
        key,
        ref: x.ref,
        name: x.name,
        color: x.color,
        mode: x.mode,
        operator: x.operator,
        directions: [],
        roles: [],
        timetableId: timetableOf(x.id),
      };
      byKey.set(key, s);
    }
    return s;
  };
  for (const l of mine) {
    const s = get(l);
    if (generic(s.name, s.ref) && !generic(l.name, l.ref)) s.name = l.name;
    s.operator = l.operator ?? s.operator;
    s.website ??= l.website;
    s.timetableId ??= timetableOf(l.id);
    if (!s.roles.includes("mine")) s.roles.push("mine");
    s.directions.push({ id: l.id, from: l.from, to: l.to, stops: l.stops.length });
  }
  for (const r of routes) {
    const s = get(r);
    if (!s.roles.includes("work")) s.roles.push("work");
    if (!s.directions.some((d) => d.id === r.id)) s.directions.push({ id: r.id, stops: r.path.length });
    if (r.kind && kindRank(r.kind) < kindRank(s.kind)) s.kind = r.kind;
  }
  // Lines near work first, then intercity lines, estimated legs, transfer lines and the ones the user added;
  // within each group, by number.
  return [...byKey.values()].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      (a.ref ?? a.name).localeCompare(b.ref ?? b.name, LOCALE_TAG, { numeric: true }),
  );
}

const KIND_ORDER: RouteKind[] = ["nearWork", "intercity", "estimated", "feeder"];
const kindRank = (k: RouteKind | undefined) => (k ? KIND_ORDER.indexOf(k) : KIND_ORDER.length);

/** Short text for the line's role ("near work", "intercity"…), localized. */
export function lineRoleLabel(l: Pick<LineSummary, "kind" | "roles">): string {
  const roles = t.transit.lineRoles;
  const parts: string[] = [];
  if (l.kind === "nearWork") parts.push(roles.nearWork);
  else if (l.kind === "intercity") parts.push(roles.intercity);
  else if (l.kind === "estimated") parts.push(roles.estimated);
  else if (l.roles.includes("work")) parts.push(roles.toWork);
  if (l.roles.includes("mine")) parts.push(roles.mine);
  return parts.join(" · ");
}

/** Closest stop of a line (up to 3 km). */
export function nearestStop(line: Pick<BusLine, "stops">, p: LatLng): { name?: string; dist: number } | null {
  let best: { name?: string; dist: number } | null = null;
  for (const s of line.stops) {
    const d = distance(p, s);
    if (d <= 3000 && (!best || d < best.dist)) best = { name: s.name, dist: d };
  }
  return best;
}
