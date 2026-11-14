import { useEffect, useMemo, useState } from "react";
import type { LineTimetable } from "../../shared/types";
import { Icon } from "../icons";
import { dayLabelFor, loadTimetable, nextDepartures, serviceMinutes, type LineSummary } from "../lines";

interface Props {
  line: LineSummary;
  onClose: () => void;
}

/** Grade de horários da linha: sentido, tipo de dia, próximas saídas em destaque. */
export function TimetableModal({ line, onClose }: Props) {
  const [data, setData] = useState<LineTimetable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dir, setDir] = useState(0);
  const now = useMemo(() => new Date(), []);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    if (!line.timetableId) return;
    void loadTimetable(line.timetableId).then((t) => (t ? setData(t) : setError("Não deu para buscar a grade agora no site do operador.")));
  }, [line.timetableId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = data?.directions[dir];
  const labels = d?.days.map((x) => x.label) ?? [];
  const today = dayLabelFor(labels, now);
  const shownDay = day && labels.includes(day) ? day : today;
  const times = d?.days.find((x) => x.label === shownDay)?.times ?? [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = shownDay === today ? nextDepartures(times, nowMin, 3) : [];
  const nextSet = new Set(next);
  const firstNext = next[0];
  const mins = serviceMinutes(times);
  const minsTo = firstNext ? mins[times.indexOf(firstNext)]! - nowMin : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tt" role="dialog" aria-label={`Horários da linha ${line.ref ?? line.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="tt-head">
          <span className="line-badge big" style={{ background: line.color }}>{line.ref ?? "•"}</span>
          <span className="line-pop-title">
            <b>{data?.name ?? line.name}</b>
            <small>{data?.operator ?? line.operator}</small>
          </span>
          <button type="button" className="ms-close" aria-label="Fechar" onClick={onClose}><Icon name="x" size={18} /></button>
        </header>

        {!data && !error && <p className="hint"><span className="spinner small" /> Buscando a grade no site do operador…</p>}
        {error && <div className="alert err"><Icon name="alert" /> {error}</div>}

        {data && (
          <>
            {data.directions.length > 1 && (
              <div className="seg" role="group" aria-label="Sentido">
                {data.directions.map((x, i) => (
                  <button key={x.direction} type="button" aria-pressed={dir === i} onClick={() => setDir(i)}>
                    Saindo de {x.from ?? `sentido ${x.direction}`}
                  </button>
                ))}
              </div>
            )}
            {d?.to && <p className="tt-dest"><Icon name="bus" size={14} /> {d.from} <span className="muted">→</span> {d.to}</p>}
            <div className="pills" role="group" aria-label="Dia">
              {labels.map((lb) => (
                <button key={lb} type="button" className="pill" aria-pressed={shownDay === lb} onClick={() => setDay(lb)}>
                  {lb}
                  {lb === today && <span className="pill-meta">hoje</span>}
                </button>
              ))}
            </div>
            {shownDay === today && (
              <p className="tt-next">
                {firstNext
                  ? <>Próxima saída <b>{firstNext}</b>{minsTo != null && minsTo >= 0 ? ` (daqui a ${minsTo} min)` : ""}{next.length > 1 ? `, depois ${next.slice(1).join(" e ")}` : ""}.</>
                  : "Sem mais saídas hoje nesse sentido."}
              </p>
            )}
            <div className="tt-grid">
              {times.map((t, i) => (
                <span key={i} className="tt-time" data-next={nextSet.has(t) || undefined} data-past={(shownDay === today && mins[i]! < nowMin) || undefined}>
                  {t}
                </span>
              ))}
              {!times.length && <span className="hint">Sem saídas nesse dia.</span>}
            </div>
            <p className="hint">
              {times.length} saídas · horários de partida do ponto inicial
              {data.updated ? ` · atualizado pelo operador em ${data.updated}` : ""}.
            </p>
            {data.note && <div className="note"><Icon name="help" size={16} /><span>{data.note}</span></div>}
            {data.source && (
              <a className="btn small" href={line.website ?? data.source} target="_blank" rel="noopener">Ver no site do operador <Icon name="ext" size={14} /></a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
