import type { BusLine, Listing } from "@homematch/contracts";
import { money, nearestStop, priceOf, shortVia, type Filters } from "@homematch/domain";
import { t } from "@homematch/i18n";

const msg = t.ui.listing;

/** "Apartamento · 60 m² · 2 quartos · 1 vaga". */
export function specsLine(l: Listing): string {
  return [
    l.typeLabel,
    l.area ? `${l.area} m²` : "",
    l.bedrooms != null ? msg.bedrooms(l.bedrooms) : "",
    l.parking ? msg.parking(l.parking) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Rent + condo fee (+ tax), when the total includes more than the rent. */
export function breakdown(l: Listing): string {
  if (!l.rent) return msg.noPriceInfo;
  if (l.total <= l.rent) return msg.rentOnly;
  const parts = [msg.rent(money(l.rent))];
  if (l.condo) parts.push(msg.condo(money(l.condo)));
  if (l.iptu) parts.push(msg.iptu(money(l.iptu)));
  if (!l.condo && !l.iptu) parts.push(msg.fees(money(l.total - l.rent)));
  return parts.join(" + ");
}

/** How much the listing goes over the target (or null when it does not / no target). */
export function overBudget(l: Listing, f: Filters): number | null {
  const price = priceOf(l, f.basis);
  return f.budget && price > f.budget ? price - f.budget : null;
}

/** Nearest stop among the lines on the map (prefers the one the commute uses). */
export function bestStop(l: Listing, lines: BusLine[], via?: string) {
  const all = lines
    .map((line) => ({ line, ns: nearestStop(line, l) }))
    .filter((x): x is { line: BusLine; ns: NonNullable<ReturnType<typeof nearestStop>> } => !!x.ns)
    .sort((a, b) => a.ns.dist - b.ns.dist);
  const used = via ? all.find((x) => x.line.ref && shortVia(via).split(" + ").includes(x.line.ref)) : undefined;
  return used ?? all[0];
}
