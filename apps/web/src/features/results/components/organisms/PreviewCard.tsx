import type { BusLine } from "@homematch/contracts";
import { meters, money, priceOf, shortVia, walkMin, type Filters, type Ranked } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { ExternalLink, Icon, Photo } from "@/shared/ui";
import { sourceName } from "@/shared/lib/format";
import { bestStop, overBudget, specsLine } from "../../lib/listing-text";
import { MatchBadge } from "../atoms/MatchBadge";

const msg = t.ui.preview;

interface Props {
  item: Ranked;
  filters: Filters;
  busLines: BusLine[];
  onOpen: () => void;
  onClose: () => void;
  fav: boolean;
  onToggleFav: () => void;
}

/** Card of the selected listing, over the map. */
export function PreviewCard({ item: { l, cell, match }, filters, busLines, onOpen, onClose, fav, onToggleFav }: Props) {
  const price = priceOf(l, filters.basis);
  const over = overBudget(l, filters);
  const stop = bestStop(l, busLines, cell?.via);
  const walking = cell?.travel === "walk";
  const favLabel = fav ? t.ui.listing.unfavorite : t.ui.listing.favorite;
  return (
    <article className="preview" aria-label={msg.label}>
      <button type="button" className="preview-close" aria-label={msg.close} onClick={onClose}>
        <Icon name="x" size={16} />
      </button>
      <Photo className="preview-photo" src={l.image} label={msg.noPhoto} />
      <div className="preview-body">
        <div className="lcard-top">
          <span className="price big">
            {price ? money(price) : t.ui.listing.noPrice}
            <small>{t.ui.listing.perMonth}</small>
          </span>
          <MatchBadge value={match} />
        </div>
        {over != null && <span className="over">{msg.overTarget(money(over))}</span>}
        <span className="lcard-title">{specsLine(l)}</span>
        <span className="lcard-sub">{l.region ?? l.address}</span>
        <div className="trip-mini">
          {stop && (
            <>
              <span>
                <Icon name="walk" size={14} /> {msg.walkMinutes(walkMin(stop.ns.dist))}
              </span>
              <Icon name="chevR" size={12} />
              <span className="line-tag" style={{ background: stop.line.color }}>
                {stop.line.ref ?? msg.line}
              </span>
              <span className="muted">{msg.stopAt(meters(stop.ns.dist))}</span>
            </>
          )}
          {!stop && cell && (
            <span>
              <Icon name={walking ? "walk" : "bus"} size={14} /> {walking ? msg.onFoot : shortVia(cell.via)}
            </span>
          )}
          {cell ? (
            <b className="trip-total">{msg.toWork(cell.commuteMin)}</b>
          ) : (
            <span className="muted">{msg.outsideArea}</span>
          )}
        </div>
        <div className="row">
          <button type="button" className="btn primary grow" onClick={onOpen}>
            {msg.details}
          </button>
          <button
            type="button"
            className="btn fav-inline"
            aria-pressed={fav}
            aria-label={favLabel}
            title={favLabel}
            onClick={onToggleFav}
          >
            <Icon name="heart" size={16} />
          </button>
          <ExternalLink className="btn" href={l.url}>
            {sourceName(l, msg.listingFallback)} <Icon name="ext" size={15} />
          </ExternalLink>
        </div>
      </div>
    </article>
  );
}
