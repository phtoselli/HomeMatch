import type { Cell } from "@homematch/contracts";
import { noTransitNear, shortVia } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { Icon } from "@/shared/ui";

const msg = t.ui.listing;

/** Time to work from the listing's area: on foot, by line, or why there is no estimate. */
export function CommuteChip({ cell }: { cell?: Cell }) {
  if (!cell)
    return (
      <span className="chip-mini muted-chip">
        <Icon name="bus" size={13} /> {msg.outsideRegions}
      </span>
    );
  if (noTransitNear(cell))
    return (
      <span className="chip-mini muted-chip">
        <Icon name="bus" size={13} /> {t.ui.results.noBusNearby}
      </span>
    );
  const walking = cell.travel === "walk";
  return (
    <span className="chip-mini transit">
      <Icon name={walking ? "walk" : "bus"} size={13} />
      {walking ? msg.minutesOnFoot(cell.commuteMin) : msg.minutesVia(cell.commuteMin, shortVia(cell.via))}
    </span>
  );
}
