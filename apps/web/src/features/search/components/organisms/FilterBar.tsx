import type { AmenityId, FeatureDef } from "@homematch/contracts";
import { FILTERABLE_AMENITIES, amenityLabel, meters, money, type Filters } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { shortLabel } from "@/shared/lib/format";
import { AMENITY_ICON, FEATURE_ICON, Icon } from "@/shared/ui";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  features: FeatureDef[];
  chosen: Record<string, number>;
  /** Main priority (transit or a place). */
  mainLabel: string;
  onEdit: (step: number) => void;
}

const msg = t.ui.filterBar;

/**
 * The request at a glance, in one line. Property items (cabinets, sink…) toggle immediately, because they only
 * reorder the list; everything else opens the search screen.
 */
export function FilterBar({ filters: f, setFilters, features, chosen, mainLabel, onEdit }: Props) {
  const toggleAmenity = (id: AmenityId) => {
    const has = (f.amenities ?? []).includes(id);
    setFilters({ ...f, amenities: has ? (f.amenities ?? []).filter((x) => x !== id) : [...(f.amenities ?? []), id] });
  };
  return (
    <div className="filterbar" role="group" aria-label={t.ui.topBar.yourSearch}>
      <button type="button" className="fchip" onClick={() => onEdit(0)}>
        <Icon name="wallet" size={15} /> {f.budget ? msg.upTo(money(f.budget)) : msg.anyPrice}
      </button>
      <button type="button" className="fchip" onClick={() => onEdit(0)}>
        <Icon name="bed" size={15} /> {f.minBedrooms ? msg.bedroomsPlus(f.minBedrooms) : msg.anyBedrooms}
      </button>
      <button type="button" className="fchip" onClick={() => onEdit(0)}>
        <Icon name="star" size={15} /> {msg.priority(mainLabel)}
      </button>
      {f.types.length > 0 && (
        <button type="button" className="fchip" onClick={() => onEdit(3)}>
          <Icon name="home" size={15} /> {f.types.map((type) => t.listings.propertyTypes[type]).join(", ")}
        </button>
      )}
      {features
        .filter((d) => d.id in chosen)
        .map((d) => (
          <button
            key={d.id}
            type="button"
            className="fchip near"
            onClick={() => onEdit(0)}
            title={msg.placeWithin(d.label, meters(chosen[d.id]!))}
          >
            <Icon name={FEATURE_ICON[d.id] ?? "pin"} size={15} />{" "}
            {msg.placeAt(shortLabel(d.label), meters(chosen[d.id]!))}
          </button>
        ))}
      <span className="fsep" aria-hidden="true" />
      {FILTERABLE_AMENITIES.map((id) => (
        <button
          key={id}
          type="button"
          className="fchip toggle"
          aria-pressed={(f.amenities ?? []).includes(id)}
          onClick={() => toggleAmenity(id)}
        >
          <Icon name={AMENITY_ICON[id] ?? "check"} size={15} /> {amenityLabel(id).short}
        </button>
      ))}
      <button type="button" className="fchip fmore" onClick={() => onEdit(3)}>
        {msg.moreOptions} <Icon name="chevR" size={14} />
      </button>
    </div>
  );
}
