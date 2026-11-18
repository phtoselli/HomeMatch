import { dayLabelFor, nextDepartures, type LineSummary, lineRoleLabel } from "@homematch/domain";
import { useTimetable } from "@/shared/api/queries";
import { CloseButton, ExternalLink, Icon, Spinner } from "@/shared/ui";
import { t } from "@homematch/i18n";

interface Props {
  line: LineSummary;
  /** Mouse position inside the map. */
  x: number;
  y: number;
  /** Size of the map area (to stay on screen). */
  width: number;
  height: number;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  onHide: () => void;
  onTimetable: () => void;
}

const W = 300;

const msg = t.ui.linePopover;

/**
 * Popover of the hovered line: number, name, directions (where it starts and ends), next departure, stops and
 * actions (timetable, hide, website). Name and directions come from the operator when it publishes them.
 */
export function LinePopover(p: Props) {
  const l = p.line;
  const { data: tt, isLoading } = useTimetable(l.timetableId);

  // Opens next to the mouse, flipping inwards near the edges.
  const left = Math.max(8, Math.min(p.x + 14, p.width - W - 8));
  const top = p.y + 14 + 260 > p.height ? Math.max(8, p.y - 14 - 260) : p.y + 14;
  const stops = Math.max(0, ...l.directions.map((d) => d.stops));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dirs = tt
    ? tt.directions.map((d) => {
        const today = dayLabelFor(
          d.days.map((x) => x.label),
          now,
        );
        const next = nextDepartures(d.days.find((x) => x.label === today)?.times ?? [], nowMin, 1)[0];
        return { id: String(d.direction), from: d.from, to: d.to, next };
      })
    : l.directions
        .filter((d) => d.from || d.to)
        .map((d) => ({ id: d.id, from: d.from, to: d.to, next: undefined as string | undefined }));
  const name = tt?.name ? `${tt.name.charAt(0)}${tt.name.slice(1).toLowerCase()}` : l.name;

  return (
    <div
      className="line-pop"
      style={{ left, top, width: W }}
      role="dialog"
      aria-label={`Linha ${l.ref ?? l.name}`}
      onMouseEnter={p.onEnter}
      onMouseLeave={p.onLeave}
    >
      <div className="line-pop-head">
        <span className="line-badge big" style={{ background: l.color }}>
          {l.ref ?? "•"}
        </span>
        <span className="line-pop-title">
          <b>{name}</b>
          {(tt?.operator ?? l.operator) && <small>{tt?.operator ?? l.operator}</small>}
        </span>
        {p.pinned && <CloseButton onClick={p.onClose} />}
      </div>
      {dirs.length > 0 ? (
        <ul className="line-pop-dirs">
          {dirs.map((d) => (
            <li key={d.id}>
              <span>
                <Icon name="bus" size={13} /> {d.from ?? "?"} <span className="muted">→</span> {d.to ?? "?"}
              </span>
              {d.next && <span className="line-next">{msg.next(d.next.slice(0, 5))}</span>}
            </li>
          ))}
        </ul>
      ) : isLoading ? (
        <p className="line-pop-meta">
          <Spinner small /> {msg.loading}
        </p>
      ) : null}
      <p className="line-pop-meta">
        {stops > 0 && <>{msg.stopsPerDirection(stops)} · </>}
        {lineRoleLabel(l)}
      </p>
      <div className="line-pop-actions">
        {l.timetableId ? (
          <button type="button" className="btn primary small" onClick={p.onTimetable}>
            <Icon name="clock" size={15} /> {msg.seeTimetable}
          </button>
        ) : (
          <span className="hint">{msg.noTimetable}</span>
        )}
        <button type="button" className="btn small" onClick={p.onHide}>
          {msg.hide}
        </button>
        <ExternalLink className="btn small" href={l.website} title={msg.openOperatorSite}>
          <Icon name="ext" size={14} />
        </ExternalLink>
      </div>
      {!p.pinned && <span className="line-pop-tip">{msg.pinTip}</span>}
    </div>
  );
}
