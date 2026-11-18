import type { Listing } from "@homematch/contracts";
import { FILTERABLE_AMENITIES, amenityLabel, hasAmenity, type Filters } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { Icon } from "@/shared/ui";

const msg = t.ui.listing;

/** Requested items: confirmed (✓), unknown (?) or missing (×) — by icon and text, not color alone. */
export function AmenityChips({ l, f }: { l: Listing; f: Filters }) {
  const wanted = f.amenities ?? [];
  if (!wanted.length) {
    if (!l.amenities?.length) return null;
    return (
      <>
        {l.amenities.map((a) => (
          <span key={a} className="chip-mini yes">
            <Icon name="check" size={12} stroke={2.6} />
            {amenityLabel(a).label}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {FILTERABLE_AMENITIES.filter((id) => wanted.includes(id)).map((id) => {
        const h = hasAmenity(l, id);
        const cls = h === true ? "yes" : h === false ? "no" : "unk";
        const word = h === true ? msg.has : h === false ? msg.hasNot : msg.unknown;
        const { label, short } = amenityLabel(id);
        return (
          <span key={id} className={`chip-mini ${cls}`} aria-label={`${label}: ${word}`} title={`${label}: ${word}`}>
            <Icon name={h === true ? "check" : h === false ? "x" : "help"} size={12} stroke={2.4} />
            {short}
          </span>
        );
      })}
    </>
  );
}
