import type { Cell, Listing } from "@homematch/contracts";
import {
  AMENITY_FILTERS,
  AMENITY_LABEL,
  hasAmenity,
  money,
  priceOf,
  type Filters,
  noTransitNear,
} from "@homematch/domain";
import { Icon } from "@/shared/ui";

/** "Ônibus 350 + Ônibus 353" → "350 + 353"; "a pé" fica igual. */
export const shortVia = (via: string) =>
  via.replace(/(Ônibus|Trólebus|Metrô|Trem|VLT|Bonde\/VLT|Monotrilho)[: ]\s*/g, "").trim();

export function specsLine(l: Listing): string {
  return [
    l.typeLabel,
    l.area ? `${l.area} m²` : "",
    l.bedrooms != null ? `${l.bedrooms} ${l.bedrooms === 1 ? "quarto" : "quartos"}` : "",
    l.parking ? `${l.parking} ${l.parking === 1 ? "vaga" : "vagas"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Aluguel + condomínio (+ IPTU), quando o total tem mais que o aluguel. */
export function breakdown(l: Listing): string {
  if (!l.rent) return "Preço não informado";
  if (l.total <= l.rent) return "Só aluguel";
  const parts = [`Aluguel ${money(l.rent)}`];
  if (l.condo) parts.push(`cond. ${money(l.condo)}`);
  if (l.iptu) parts.push(`IPTU ${money(l.iptu)}`);
  if (!l.condo && !l.iptu) parts.push(`taxas ${money(l.total - l.rent)}`);
  return parts.join(" + ");
}

/** Quanto passa do alvo (ou null se não passa / sem alvo). */
export function overBudget(l: Listing, f: Filters): number | null {
  const price = priceOf(l, f.basis);
  return f.budget && price > f.budget ? price - f.budget : null;
}

export function MatchBadge({ value }: { value: number }) {
  const tone = value >= 80 ? "hi" : value >= 65 ? "mid" : "lo";
  return (
    <span
      className={`match ${tone}`}
      title="Combina preço x alvo, tempo até o trabalho, itens confirmados no anúncio e o que tem perto"
    >
      {value}% match
    </span>
  );
}

export function CommuteChip({ cell }: { cell?: Cell }) {
  if (!cell)
    return (
      <span className="chip-mini muted-chip">
        <Icon name="bus" size={13} /> fora das regiões recomendadas
      </span>
    );
  if (noTransitNear(cell))
    return (
      <span className="chip-mini muted-chip">
        <Icon name="bus" size={13} /> sem ônibus por perto
      </span>
    );
  return (
    <span className="chip-mini transit">
      <Icon name={cell.via === "a pé" ? "walk" : "bus"} size={13} />
      {cell.commuteMin} min{cell.via !== "a pé" ? ` · ${shortVia(cell.via)}` : " a pé"}
    </span>
  );
}

/** Itens pedidos: confirmado (✓), não informado (?) ou não tem (×) — por ícone e texto, não só cor. */
export function AmenityChips({ l, f }: { l: Listing; f: Filters }) {
  const wanted = f.amenities ?? [];
  if (!wanted.length) {
    if (!l.amenities?.length) return null;
    return (
      <>
        {l.amenities.map((a) => (
          <span key={a} className="chip-mini yes">
            <Icon name="check" size={12} stroke={2.6} />
            {AMENITY_LABEL[a] ?? a}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {AMENITY_FILTERS.filter((a) => wanted.includes(a.id)).map((a) => {
        const h = hasAmenity(l, a.id);
        const cls = h === true ? "yes" : h === false ? "no" : "unk";
        const word = h === true ? "sim" : h === false ? "não tem" : "não informado";
        return (
          <span
            key={a.id}
            className={`chip-mini ${cls}`}
            aria-label={`${a.label}: ${word}`}
            title={`${a.label}: ${word}`}
          >
            <Icon name={h === true ? "check" : h === false ? "x" : "help"} size={12} stroke={2.4} />
            {a.short}
          </span>
        );
      })}
    </>
  );
}
