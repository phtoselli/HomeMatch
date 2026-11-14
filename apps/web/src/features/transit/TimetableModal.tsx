import { useMemo, useState } from "react";
import { dayLabelFor, nextDepartures, serviceMinutes, type LineSummary } from "@homematch/domain";
import { useTimetable } from "../../shared/api/queries";
import { CloseButton, ErrorAlert, Icon, Modal, Segmented, Spinner } from "../../shared/ui";

interface Props {
  line: LineSummary;
  onClose: () => void;
}

/** Grade de horários da linha: sentido, tipo de dia, próximas saídas em destaque. */
export function TimetableModal({ line, onClose }: Props) {
  const { data, isError } = useTimetable(line.timetableId);
  const [dir, setDir] = useState(0);
  const now = useMemo(() => new Date(), []);
  const [day, setDay] = useState<string | null>(null);

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
    <Modal className="tt" label={`Horários da linha ${line.ref ?? line.name}`} onClose={onClose}>
      <header className="tt-head">
        <span className="line-badge big" style={{ background: line.color }}>
          {line.ref ?? "•"}
        </span>
        <span className="line-pop-title">
          <b>{data?.name ?? line.name}</b>
          <small>{data?.operator ?? line.operator}</small>
        </span>
        <CloseButton onClick={onClose} size={18} />
      </header>

      {!data && !isError && (
        <p className="hint">
          <Spinner small /> Buscando a grade no site do operador…
        </p>
      )}
      {isError && <ErrorAlert>Não deu para buscar a grade agora no site do operador.</ErrorAlert>}

      {data && (
        <>
          {data.directions.length > 1 && (
            <Segmented
              label="Sentido"
              value={dir}
              onChange={setDir}
              options={data.directions.map((x, i) => ({
                value: i,
                label: `Saindo de ${x.from ?? `sentido ${x.direction}`}`,
              }))}
            />
          )}
          {d?.to && (
            <p className="tt-dest">
              <Icon name="bus" size={14} /> {d.from} <span className="muted">→</span> {d.to}
            </p>
          )}
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
              {firstNext ? (
                <>
                  Próxima saída <b>{firstNext}</b>
                  {minsTo != null && minsTo >= 0 ? ` (daqui a ${minsTo} min)` : ""}
                  {next.length > 1 ? `, depois ${next.slice(1).join(" e ")}` : ""}.
                </>
              ) : (
                "Sem mais saídas hoje nesse sentido."
              )}
            </p>
          )}
          <div className="tt-grid">
            {times.map((t, i) => (
              <span
                key={i}
                className="tt-time"
                data-next={nextSet.has(t) || undefined}
                data-past={(shownDay === today && mins[i]! < nowMin) || undefined}
              >
                {t}
              </span>
            ))}
            {!times.length && <span className="hint">Sem saídas nesse dia.</span>}
          </div>
          <p className="hint">
            {times.length} saídas · horários de partida do ponto inicial
            {data.updated ? ` · atualizado pelo operador em ${data.updated}` : ""}.
          </p>
          {data.note && (
            <div className="note">
              <Icon name="help" size={16} />
              <span>{data.note}</span>
            </div>
          )}
          {data.source && (
            <a className="btn small" href={line.website ?? data.source} target="_blank" rel="noopener">
              Ver no site do operador <Icon name="ext" size={14} />
            </a>
          )}
        </>
      )}
    </Modal>
  );
}
