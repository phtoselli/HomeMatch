// Horários de partida: tipo de dia, ordem de serviço (depois da meia-noite) e próximas saídas.

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
