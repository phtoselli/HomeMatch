import type { BusLine, LineTimetable, TransitMode, TransitRoute } from "../shared/types";
import { api } from "./api";

/** Grade de horários com cache na página (passar o mouse várias vezes não repete o pedido). */
const timetables = new Map<string, Promise<LineTimetable | null>>();
export function loadTimetable(id: string): Promise<LineTimetable | null> {
  let p = timetables.get(id);
  if (!p) {
    p = api.timetable(id).catch(() => {
      timetables.delete(id); // erro passageiro: tenta de novo na próxima vez
      return null;
    });
    timetables.set(id, p);
  }
  return p;
}

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
const timetableOf = (id: string) => id.match(/^([a-z]+):([^:]+)/i)?.slice(1, 3).join(":");

/** Junta as linhas da análise e as que a pessoa adicionou, por número. */
export function summarizeLines(routes: TransitRoute[], mine: BusLine[]): LineSummary[] {
  const byKey = new Map<string, LineSummary>();
  const get = (x: { id: string; ref?: string; name: string; color: string; mode: TransitMode; operator?: string }) => {
    const key = lineKey(x);
    let s = byKey.get(key);
    if (!s) {
      s = { key, ref: x.ref, name: x.name, color: x.color, mode: x.mode, operator: x.operator, directions: [], roles: [], timetableId: timetableOf(x.id) };
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
  return [...byKey.values()].sort((a, b) => (a.ref ?? a.name).localeCompare(b.ref ?? b.name, "pt-BR", { numeric: true }));
}

/** Tipo de dia da grade para uma data ("Dias úteis", "Sábados", "Domingos/Feriados"). */
export function dayLabelFor(labels: string[], date: Date): string | undefined {
  const dow = date.getDay();
  const want = dow === 0 ? /domingo|feriado/i : dow === 6 ? /s[áa]bado/i : /[úu]te(is|l)|segunda/i;
  return labels.find((l) => want.test(l)) ?? labels[0];
}

/**
 * Minutos do dia de cada horário, em ordem de serviço: o que vem depois da meia-noite no fim da
 * grade ("00:00", "00:30") conta como +24 h, não como o começo do dia.
 */
export function serviceMinutes(times: string[]): number[] {
  let prev = -1;
  let extra = 0;
  return times.map((t) => {
    const m = t.match(/(\d{1,2}):(\d{2})/);
    if (!m) return NaN;
    let v = Number(m[1]) * 60 + Number(m[2]) + extra;
    if (v < prev) {
      extra += 1440;
      v += 1440;
    }
    prev = v;
    return v;
  });
}

/** Próximas saídas a partir de "agora" (minutos do dia), já em ordem. */
export function nextDepartures(times: string[], nowMin: number, n = 3): string[] {
  const mins = serviceMinutes(times);
  return times.filter((_, i) => mins[i]! >= nowMin).slice(0, n);
}
