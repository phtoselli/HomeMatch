import { PROPERTY_TYPE_LABEL, type FeatureDef } from "@homematch/contracts";
import { AMENITY_FILTERS, meters, money, type Filters } from "@homematch/domain";
import { AMENITY_ICON, FEATURE_ICON, Icon } from "../../shared/ui/Icon";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  features: FeatureDef[];
  chosen: Record<string, number>;
  maxCommuteMin: number;
  onEdit: (step: number) => void;
}

/**
 * O pedido à vista, em uma linha. Os itens do imóvel (armário, pia…) ligam e desligam na hora, porque só
 * reordenam a lista; o resto abre a tela da busca.
 */
export function FilterBar({ filters: f, setFilters, features, chosen, maxCommuteMin, onEdit }: Props) {
  const toggleAmenity = (id: string) => {
    const has = (f.amenities ?? []).includes(id);
    setFilters({ ...f, amenities: has ? (f.amenities ?? []).filter((x) => x !== id) : [...(f.amenities ?? []), id] });
  };
  return (
    <div className="filterbar" role="group" aria-label="Sua busca">
      <button type="button" className="fchip" onClick={() => onEdit(0)}>
        <Icon name="wallet" size={15} /> {f.budget ? `Até ${money(f.budget)}` : "Qualquer preço"}
      </button>
      <button type="button" className="fchip" onClick={() => onEdit(0)}>
        <Icon name="bed" size={15} /> {f.minBedrooms ? `${f.minBedrooms}+ quartos` : "Quartos: tanto faz"}
      </button>
      <button type="button" className="fchip" onClick={() => onEdit(0)}>
        <Icon name="clock" size={15} /> Até {maxCommuteMin} min
      </button>
      {f.types.length > 0 && (
        <button type="button" className="fchip" onClick={() => onEdit(3)}>
          <Icon name="home" size={15} /> {f.types.map((t) => PROPERTY_TYPE_LABEL[t]).join(", ")}
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
            title={`${d.label} a até ${meters(chosen[d.id]!)}`}
          >
            <Icon name={FEATURE_ICON[d.id] ?? "pin"} size={15} /> {d.label.split(" / ")[0]} a {meters(chosen[d.id]!)}
          </button>
        ))}
      <span className="fsep" aria-hidden="true" />
      {AMENITY_FILTERS.map((a) => (
        <button
          key={a.id}
          type="button"
          className="fchip toggle"
          aria-pressed={(f.amenities ?? []).includes(a.id)}
          onClick={() => toggleAmenity(a.id)}
        >
          <Icon name={AMENITY_ICON[a.id] ?? "check"} size={15} /> {a.short}
        </button>
      ))}
      <button type="button" className="fchip fmore" onClick={() => onEdit(3)}>
        Mais opções <Icon name="chevR" size={14} />
      </button>
    </div>
  );
}
