import type { BusLine, LatLng, TransitMode, TransitRoute } from "@homematch/contracts";
import { distance } from "../geo.js";

/** Uma linha de ônibus como a pessoa pensa nela: o número, com os dois sentidos juntos. */
export interface LineSummary {
  /** Chave da linha (número; sem número, o id). É o que liga/desliga no mapa. */
  key: string;
  ref?: string;
  name: string;
  color: string;
  mode: TransitMode;
  operator?: string;
  website?: string;
  directions: { id: string; from?: string; to?: string; stops: number }[];
  /** work = a análise usa para chegar ao trabalho; mine = você adicionou. */
  roles: ("work" | "mine")[];
  /** Id para pedir a grade de horários ("emdec:353"), quando o operador publica. */
  timetableId?: string;
}

export const lineKey = (x: { ref?: string; id: string }) => x.ref ?? x.id;

const generic = (name: string, ref?: string) => !name || name === `Linha ${ref}`;
const timetableOf = (id: string) =>
  id
    .match(/^([a-z]+):([^:]+)/i)
    ?.slice(1, 3)
    .join(":");

/** Junta as linhas da análise e as que a pessoa adicionou, por número. */
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
  }
  return [...byKey.values()].sort((a, b) =>
    (a.ref ?? a.name).localeCompare(b.ref ?? b.name, "pt-BR", { numeric: true }),
  );
}

/** Parada mais próxima de uma linha (até 3 km). */
export function nearestStop(line: Pick<BusLine, "stops">, p: LatLng): { name?: string; dist: number } | null {
  let best: { name?: string; dist: number } | null = null;
  for (const s of line.stops) {
    const d = distance(p, s);
    if (d <= 3000 && (!best || d < best.dist)) best = { name: s.name, dist: d };
  }
  return best;
}
