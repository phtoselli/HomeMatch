import { useEffect, useRef } from "react";
import type { BusLine, FeatureDef, LatLng } from "@homematch/contracts";
import {
  FILTERABLE_AMENITIES,
  amenityLabel,
  ceilingOf,
  distance,
  hasAmenity,
  levelLabel,
  meters,
  money,
  noTransitNear,
  priceOf,
  shortVia,
  walkMin,
  type CommuteRef,
  type Filters,
  type Ranked,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { useEscape } from "@/shared/hooks/useEscape";
import { sourceName } from "@/shared/lib/format";
import { ExternalLink, FEATURE_ICON, Icon, type IconName, Photo } from "@/shared/ui";
import { bestStop } from "../../lib/listing-text";
import { MatchBadge } from "../atoms/MatchBadge";

interface Props {
  item: Ranked;
  filters: Filters;
  /** The city's best commute and up to how long transit counts as met (from the analysis). */
  commuteRef: CommuteRef | null;
  features: FeatureDef[];
  chosen: Record<string, number>;
  busLines: BusLine[];
  work: LatLng | null;
  onClose: () => void;
  fav: boolean;
  onToggleFav: () => void;
}

const msg = t.ui.detail;

type Status = "yes" | "warn" | "no" | "unk";
const STATUS_ICON: Record<Status, IconName> = { yes: "check", warn: "alert", no: "x", unk: "help" };

/** Listing detail: how it meets the request, price vs. target, commute and what is nearby. */
export function ListingDetail({
  item: { l, cell, match },
  filters: f,
  commuteRef,
  features,
  chosen,
  busLines,
  work,
  onClose,
  fav,
  onToggleFav,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEscape(onClose);

  const price = priceOf(l, f.basis);
  const ceiling = ceilingOf(f.budget, f.slack);
  const stop = bestStop(l, busLines, cell?.via);
  const walking = cell?.travel === "walk";
  const transfer = !!cell?.via.includes("+");

  const checks: { s: Status; label: string; detail: string }[] = [];
  if (cell) {
    checks.push({
      s: cell.level === "ok" ? "warn" : "yes",
      label: msg.regionLevel(levelLabel(cell.level)),
      detail: msg.levelDetail[cell.level],
    });
    const ref = commuteRef?.refMin;
    checks.push({
      s: ref == null || cell.commuteMin <= ref ? "yes" : "warn",
      label: ref != null ? msg.wellServed(ref) : msg.commute,
      detail: noTransitNear(cell)
        ? msg.onlyWalking
        : walking
          ? msg.minutesOnFoot(cell.commuteMin)
          : msg.minutesByLine(cell.commuteMin, shortVia(cell.via)),
    });
  } else {
    checks.push({
      s: "unk",
      label: msg.recommendedRegion,
      detail: work ? msg.outsideRegionsFrom(meters(distance(l, work))) : msg.outsideRegions,
    });
  }
  if (f.budget && price) {
    const over = price - f.budget;
    checks.push({
      s: over <= 0 ? "yes" : ceiling && price <= ceiling ? "warn" : "no",
      label: msg.priceNear(f.basis === "rent", money(f.budget)),
      detail: over <= 0 ? msg.belowTarget(money(price), money(-over)) : msg.aboveTarget(money(price), money(over)),
    });
  }
  for (const id of FILTERABLE_AMENITIES.filter((x) => f.amenities?.includes(x))) {
    const h = hasAmenity(l, id);
    checks.push({
      s: h === true ? "yes" : h === false ? "no" : "unk",
      label: amenityLabel(id).label,
      detail: h === true ? msg.amenityYes : h === false ? msg.amenityNo : msg.amenityUnknown,
    });
  }
  for (const d of features.filter((x) => x.id in chosen)) {
    const dist = cell?.featureDist[d.id];
    checks.push({
      s: dist == null ? "unk" : dist <= chosen[d.id]! ? "yes" : "no",
      label: msg.onFoot(d.label),
      detail: dist == null ? msg.notMeasured : msg.distanceOnFoot(meters(dist), walkMin(dist)),
    });
  }
  const yes = checks.filter((c) => c.s === "yes").length;

  const furnished = l.furnished ?? (l.amenities?.includes("furnished") ? true : undefined);
  const unknown = msg.notInformed;
  const specs: { icon: IconName; label: string; value: string }[] = [
    { icon: "home", label: msg.type, value: l.typeLabel || t.listings.propertyTypes[l.type] },
    { icon: "area", label: msg.area, value: l.area ? `${l.area} m²` : unknown },
    { icon: "bed", label: msg.bedrooms, value: l.bedrooms != null ? String(l.bedrooms) : unknown },
    { icon: "bath", label: msg.bathrooms, value: l.bathrooms != null ? String(l.bathrooms) : unknown },
    { icon: "car", label: msg.parking, value: l.parking != null ? String(l.parking) : unknown },
    { icon: "sofa", label: msg.furnished, value: furnished == null ? unknown : furnished ? msg.yes : msg.no },
  ];

  const near = features
    .filter((d) => cell?.featureDist[d.id] != null)
    .map((d) => ({ icon: FEATURE_ICON[d.id] ?? ("pin" as IconName), label: d.label, dist: cell!.featureDist[d.id]! }));
  const stops = busLines
    .map((line) => ({ line, s: bestStop(l, [line]) }))
    .filter((x) => x.s)
    .sort((a, b) => a.s!.ns.dist - b.s!.ns.dist)
    .filter((x, i, arr) => arr.findIndex((y) => y.line.ref === x.line.ref) === i)
    .slice(0, 3);

  // Price bar: target marked, the part above it in amber.
  const scale = Math.max(price, ceiling ?? 0, f.budget ?? 0) * 1.1 || 1;
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100).toFixed(1)}%`;

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="detail-bar">
          <button ref={closeRef} type="button" className="btn ghost" onClick={onClose}>
            <Icon name="back" /> {msg.backToMap}
          </button>
          <span className="row">
            <button type="button" className="btn fav-inline" aria-pressed={fav} onClick={onToggleFav}>
              <Icon name="heart" size={16} /> {fav ? msg.favorited : msg.favorite}
            </button>
            <ExternalLink className="btn" href={l.url}>
              {msg.openOn(sourceName(l))} <Icon name="ext" size={15} />
            </ExternalLink>
          </span>
        </header>

        <div className="detail-content">
          <Photo className="detail-photo" src={l.image} label={msg.noPhoto} />

          <div className="detail-cols">
            <div className="detail-main">
              <div className="detail-head">
                <div className="row">
                  <MatchBadge value={match} />
                  <span className="tagline">
                    {sourceName(l, l.source)}
                    {l.agency && l.agency !== sourceName(l) ? ` · ${l.agency}` : ""}
                  </span>
                  {l.region && <span className="tagline">{l.region}</span>}
                </div>
                <h1 id="detail-title" className="display">
                  {l.title || l.typeLabel}
                </h1>
                <p className="lead">
                  {l.address || l.neighbourhood || msg.noAddress}
                  {l.approxLocation && <em className="approx"> · {msg.approxPosition}</em>}
                </p>
              </div>

              {checks.length > 0 && (
                <section className="card" aria-labelledby="why">
                  <h2 id="why" className="h2">
                    {msg.howItMatches}
                  </h2>
                  <p className="hint">{msg.confirmed(yes, checks.length)}</p>
                  <ul className="checks">
                    {checks.map((c) => (
                      <li key={c.label} data-s={c.s}>
                        <span className="check-badge">
                          <Icon name={STATUS_ICON[c.s]} size={15} stroke={2.6} />
                        </span>
                        <span className="check-text">
                          <b>{c.label}</b>
                          <span>{c.detail}</span>
                        </span>
                        <span className="check-tag">{msg.status[c.s]}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="card" aria-labelledby="specs">
                <h2 id="specs" className="h2">
                  {msg.features}
                </h2>
                <dl className="specs">
                  {specs.map((s) => (
                    <div key={s.label}>
                      <Icon name={s.icon} size={20} stroke={1.8} />
                      <span>
                        <dt>{s.label}</dt>
                        <dd>{s.value}</dd>
                      </span>
                    </div>
                  ))}
                </dl>
                {l.amenities && l.amenities.length > 0 && (
                  <p className="hint">{msg.itemsListed(l.amenities.map((a) => amenityLabel(a).label))}</p>
                )}
              </section>

              {(near.length > 0 || stops.length > 0) && (
                <section className="card" aria-labelledby="near">
                  <h2 id="near" className="h2">
                    {msg.nearbyOnFoot}
                  </h2>
                  <ul className="near">
                    {stops.map(({ line, s }) => (
                      <li key={line.id}>
                        <span className="near-icon" style={{ color: line.color }}>
                          <Icon name="bus" size={18} />
                        </span>
                        <span className="grow">
                          {msg.stopOf(line.ref ?? line.name)}
                          {s!.ns.name ? ` · ${s!.ns.name}` : ""}
                        </span>
                        <span className="muted">{meters(s!.ns.dist)}</span>
                        <b>{msg.minutesWalk(walkMin(s!.ns.dist))}</b>
                      </li>
                    ))}
                    {near.map((n) => (
                      <li key={n.label}>
                        <span className="near-icon">
                          <Icon name={n.icon} size={18} />
                        </span>
                        <span className="grow">{n.label}</span>
                        <span className="muted">~{meters(n.dist)}</span>
                        <b>{msg.minutesWalk(walkMin(n.dist))}</b>
                      </li>
                    ))}
                  </ul>
                  {near.length > 0 && <p className="hint">{msg.distancesHint}</p>}
                </section>
              )}
            </div>

            <aside className="detail-side">
              <section className="card">
                <span className="hint">{f.basis === "rent" ? msg.rentPerMonth : msg.totalPerMonth}</span>
                <div className="price huge">{price ? money(price) : msg.noPrice}</div>
                <dl className="rows">
                  <div>
                    <dt>{msg.rent}</dt>
                    <dd>{l.rent ? money(l.rent) : "—"}</dd>
                  </div>
                  <div>
                    <dt>{msg.condo}</dt>
                    <dd>{l.condo ? money(l.condo) : <span className="muted">{msg.notInformedLower}</span>}</dd>
                  </div>
                  <div>
                    <dt>IPTU</dt>
                    <dd>{l.iptu ? money(l.iptu) : <span className="muted">{msg.notInformedLower}</span>}</dd>
                  </div>
                </dl>
                {f.budget && price > 0 && (
                  <div className="budgetbar">
                    <div className="track" role="img" aria-label={msg.priceVsTarget(money(price), money(f.budget))}>
                      <span className="fill" style={{ width: pct(Math.min(price, f.budget)) }} />
                      {price > f.budget && (
                        <span
                          className="fill over"
                          style={{ left: pct(f.budget), width: `calc(${pct(price)} - ${pct(f.budget)})` }}
                        />
                      )}
                      <span className="mark" style={{ left: pct(f.budget) }} />
                    </div>
                    <div className="row between">
                      <span className="hint">{msg.yourTarget(money(f.budget))}</span>
                      {price > f.budget ? (
                        <b className="over">
                          {msg.above(money(price - f.budget), Math.round(((price - f.budget) / f.budget) * 100))}
                        </b>
                      ) : (
                        <b className="ok">{msg.below(money(f.budget - price))}</b>
                      )}
                    </div>
                  </div>
                )}
                <ExternalLink className="btn primary big block" href={l.url}>
                  {msg.seeListingOn(sourceName(l))} <Icon name="ext" size={16} />
                </ExternalLink>
                <span className="hint center">{msg.visitHint}</span>
              </section>

              <section className="card" aria-labelledby="trip">
                <div className="row between">
                  <h2 id="trip" className="h2">
                    {msg.toWork}
                  </h2>
                  {cell && <span className="price">{msg.minutes(cell.commuteMin)}</span>}
                </div>
                {cell ? (
                  <ol className="trip">
                    {stop && !walking && (
                      <li>
                        <span className="trip-dot">
                          <Icon name="walk" size={14} />
                        </span>
                        <span className="grow">
                          <b>{msg.walkToStop}</b>
                          <span>
                            {stop.ns.name ?? t.transit.lineName(stop.line.ref ?? "")} · {meters(stop.ns.dist)}
                          </span>
                        </span>
                        <b>{msg.minutes(walkMin(stop.ns.dist))}</b>
                      </li>
                    )}
                    {!walking && (
                      <li>
                        <span className="trip-dot">
                          <Icon name="clock" size={14} />
                        </span>
                        <span className="grow">
                          <b>{msg.waitBus}</b>
                          <span>{transfer ? msg.averageWaitEach : msg.averageWait}</span>
                        </span>
                        <b>~8 min</b>
                      </li>
                    )}
                    <li>
                      <span className="trip-dot bus">
                        <Icon name={walking ? "walk" : "bus"} size={14} />
                      </span>
                      <span className="grow">
                        <b>
                          {walking
                            ? msg.goOnFoot
                            : transfer
                              ? msg.lines(shortVia(cell.via))
                              : msg.line(shortVia(cell.via))}
                        </b>
                        <span>{transfer ? msg.withTransfer : walking ? msg.closeEnoughToWalk : msg.noTransfer}</span>
                      </span>
                    </li>
                    <li>
                      <span className="trip-dot end">
                        <Icon name="brief" size={14} />
                      </span>
                      <span className="grow">
                        <b>{msg.work}</b>
                        <span>{msg.doorToDoor}</span>
                      </span>
                      <b>{msg.minutes(cell.commuteMin)}</b>
                    </li>
                  </ol>
                ) : (
                  <p className="hint">{msg.noCommute}</p>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
