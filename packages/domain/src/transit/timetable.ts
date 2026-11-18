// Departure times: day type, service order (past midnight) and next departures.

/**
 * Day-type labels as Brazilian operators publish them ("Dias úteis", "Sábados", "Domingos/Feriados"). These match
 * the operator's data, not UI text.
 */
const OPERATOR_DAY_PATTERNS = {
  sunday: /domingo|feriado/i,
  saturday: /s[áa]bado/i,
  weekday: /[úu]te(is|l)|segunda/i,
};

/** Timetable day type for a date. */
export function dayLabelFor(labels: string[], date: Date): string | undefined {
  const dow = date.getDay();
  const want =
    dow === 0
      ? OPERATOR_DAY_PATTERNS.sunday
      : dow === 6
        ? OPERATOR_DAY_PATTERNS.saturday
        : OPERATOR_DAY_PATTERNS.weekday;
  return labels.find((l) => want.test(l)) ?? labels[0];
}

/**
 * Minutes of the day for each time, in service order: times past midnight at the end of the timetable
 * ("00:00", "00:30") count as +24 h, not as the start of the day.
 */
export function serviceMinutes(times: string[]): number[] {
  let prev = -1;
  let extra = 0;
  return times.map((time) => {
    const m = time.match(/(\d{1,2}):(\d{2})/);
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

/** Next departures from "now" (minutes of the day), in order. */
export function nextDepartures(times: string[], nowMin: number, n = 3): string[] {
  const mins = serviceMinutes(times);
  return times.filter((_, i) => mins[i]! >= nowMin).slice(0, n);
}
