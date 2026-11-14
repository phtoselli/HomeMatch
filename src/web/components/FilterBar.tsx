import type { FeatureDef } from "../../shared/types";
import { PROPERTY_TYPE_LABEL } from "../../shared/types";
import { meters } from "../format";
import { FEATURE_ICON, Icon } from "../icons";
import { AMENITY_FILTERS, type Filters } from "../search";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  features: FeatureDef[];
  chosen: Record<string, number>;
  onEdit: (step: number) => void;
}

/**
 * Filtros ativos à vista. Os itens do imóvel (armário, pia…) ligam e desligam na hora, porque são
 * aplicados no navegador; o resto abre o passo certo da configuração.
 */
export function FilterBar({ filters: f, setFilters, features, chosen, onEdit }: Props) {
  const toggleAmenity = (id: string) => {
    const has = (f.amenities ?? []).includes(id);
    setFilters({ ...f, amenities: has ? (f.amenities ?? []).filter((x) => x !== id) : [...(f.amenities ?? []), id] });
  };
  return (
    <div className="filterbar" role="group" aria-label="Filtros">
      <button type="button" className="fchip" onClick={() => onEdit(3)}>
        <Icon name="home" size={15} />
        {f.types.length ? f.types.map((t) => PROPERTY_TYPE_LABEL[t]).join(", ") : "Qualquer tipo"}
      </button>
      {f.minBedrooms > 0 && (
        <button type="button" className="fchip" onClick={() => onEdit(3)}>
          <Icon name="bed" size={15} /> {f.minBedrooms}+ quartos
        </button>
      )}
      {AMENITY_FILTERS.map((a) => (
        <button key={a.id} type="button" className="fchip toggle" aria-pressed={(f.amenities ?? []).includes(a.id)} onClick={() => toggleAmenity(a.id)}>
          <Icon name={a.icon} size={15} /> {a.label}
        </button>
      ))}
      {(f.amenities ?? []).length > 0 && (
        <button type="button" className="fchip toggle" aria-pressed={!!f.hideUnknown} onClick={() => setFilters({ ...f, hideUnknown: !f.hideUnknown })}>
          <Icon name="help" size={15} /> Esconder sem informação
        </button>
      )}
      <span className="fsep" aria-hidden="true" />
      {features.filter((d) => d.id in chosen).map((d) => (
        <button key={d.id} type="button" className="fchip near" onClick={() => onEdit(2)} title={`${d.label} a até ${meters(chosen[d.id]!)}`}>
          <Icon name={FEATURE_ICON[d.id] ?? "pin"} size={15} /> {d.label.split(" / ")[0]} a {meters(chosen[d.id]!)}
        </button>
      ))}
      <button type="button" className="fchip fmore" onClick={() => onEdit(3)}>
        Mais filtros <Icon name="chevR" size={14} />
      </button>
    </div>
  );
}
