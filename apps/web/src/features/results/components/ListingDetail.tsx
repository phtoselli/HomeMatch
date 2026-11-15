import { useEffect, useRef } from "react";
import { useEscape } from "@/shared/hooks/useEscape";
import { PROPERTY_TYPE_LABEL } from "@homematch/contracts/constants";
import type { BusLine, FeatureDef, LatLng } from "@homematch/contracts";
import {
  AMENITY_FILTERS,
  ceilingOf,
  distance,
  hasAmenity,
  meters,
  money,
  priceOf,
  walkMin,
  type Filters,
  type Ranked,
} from "@homematch/domain";
import { ExternalLink, FEATURE_ICON, Icon, type IconName, Photo } from "@/shared/ui";
import { sourceName } from "@/shared/lib/format";
import { MatchBadge, shortVia } from "./ListingBits";
import { bestStop } from "./PreviewCard";

interface Props {
  item: Ranked;
  filters: Filters;
  maxCommuteMin: number;
  features: FeatureDef[];
  chosen: Record<string, number>;
  busLines: BusLine[];
  work: LatLng | null;
  onClose: () => void;
  fav: boolean;
  onToggleFav: () => void;
}

type Status = "yes" | "warn" | "no" | "unk";
const STATUS: Record<Status, { icon: IconName; tag: string }> = {
  yes: { icon: "check", tag: "Sim" },
  warn: { icon: "alert", tag: "Um pouco acima" },
  no: { icon: "x", tag: "Não" },
  unk: { icon: "help", tag: "Não informado" },
};

/** Detalhe do imóvel: como ele atende o que a pessoa pediu, preço x alvo, trajeto e o que tem perto. */
export function ListingDetail({
  item: { l, cell, match },
  filters: f,
  maxCommuteMin,
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

  const checks: { s: Status; label: string; detail: string }[] = [];
  if (cell) {
    checks.push({
      s: cell.commuteMin <= maxCommuteMin ? "yes" : "warn",
      label: `Até ${maxCommuteMin} min do trabalho`,
      detail: `~${cell.commuteMin} min ${cell.via === "a pé" ? "a pé" : `pela linha ${shortVia(cell.via)}`}.`,
    });
  } else {
    checks.push({
      s: "unk",
      label: `Até ${maxCommuteMin} min do trabalho`,
      detail: work
        ? `Fora da área analisada. Fica a ${meters(distance(l, work))} do trabalho em linha reta.`
        : "Fora da área analisada.",
    });
  }
  if (f.budget && price) {
    const over = price - f.budget;
    checks.push({
      s: over <= 0 ? "yes" : ceiling && price <= ceiling ? "warn" : "no",
      label: `${f.basis === "rent" ? "Aluguel" : "Total"} perto de ${money(f.budget)}`,
      detail:
        over <= 0
          ? `${money(price)} por mês, ${money(-over)} abaixo do alvo.`
          : `${money(price)} por mês, ${money(over)} acima do alvo.`,
    });
  }
  for (const a of AMENITY_FILTERS.filter((x) => f.amenities?.includes(x.id))) {
    const h = hasAmenity(l, a.id);
    checks.push({
      s: h === true ? "yes" : h === false ? "no" : "unk",
      label: a.label,
      detail:
        h === true
          ? "Citado no anúncio."
          : h === false
            ? "O anúncio não lista esse item."
            : "O anúncio não diz. Vale perguntar ou olhar na visita.",
    });
  }
  for (const d of features.filter((x) => x.id in chosen)) {
    const dist = cell?.featureDist[d.id];
    checks.push({
      s: dist == null ? "unk" : dist <= chosen[d.id]! ? "yes" : "no",
      label: `${d.label} a pé`,
      detail: dist == null ? "Não medido para este ponto." : `A ~${meters(dist)}, cerca de ${walkMin(dist)} min a pé.`,
    });
  }
  const yes = checks.filter((c) => c.s === "yes").length;

  const furnished = l.furnished ?? (l.amenities?.includes("mobiliado") ? true : undefined);
  const specs: { icon: IconName; label: string; value: string }[] = [
    { icon: "home", label: "Tipo", value: l.typeLabel || PROPERTY_TYPE_LABEL[l.type] },
    { icon: "area", label: "Área", value: l.area ? `${l.area} m²` : "Não informado" },
    { icon: "bed", label: "Quartos", value: l.bedrooms != null ? String(l.bedrooms) : "Não informado" },
    { icon: "bath", label: "Banheiros", value: l.bathrooms != null ? String(l.bathrooms) : "Não informado" },
    { icon: "car", label: "Vagas", value: l.parking != null ? String(l.parking) : "Não informado" },
    { icon: "sofa", label: "Mobiliado", value: furnished == null ? "Não informado" : furnished ? "Sim" : "Não" },
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

  // Barra do preço: alvo marcado, parte acima em âmbar.
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
            <Icon name="back" /> Voltar ao mapa
          </button>
          <span className="row">
            <button type="button" className="btn fav-inline" aria-pressed={fav} onClick={onToggleFav}>
              <Icon name="heart" size={16} /> {fav ? "Favoritado" : "Favoritar"}
            </button>
            <ExternalLink className="btn" href={l.url}>
              Abrir no {sourceName(l)} <Icon name="ext" size={15} />
            </ExternalLink>
          </span>
        </header>

        <div className="detail-content">
          <Photo className="detail-photo" src={l.image} label="O anúncio não trouxe foto" />

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
                  {l.address || l.neighbourhood || "Endereço não informado"}
                  {l.approxLocation && <em className="approx"> · posição aproximada pelo endereço</em>}
                </p>
              </div>

              {checks.length > 0 && (
                <section className="card" aria-labelledby="why">
                  <h2 id="why" className="h2">
                    Como ele atende o que você pediu
                  </h2>
                  <p className="hint">
                    {yes} de {checks.length} confirmados. O que o anúncio não diz fica marcado para você perguntar na
                    visita.
                  </p>
                  <ul className="checks">
                    {checks.map((c) => (
                      <li key={c.label} data-s={c.s}>
                        <span className="check-badge">
                          <Icon name={STATUS[c.s].icon} size={15} stroke={2.6} />
                        </span>
                        <span className="check-text">
                          <b>{c.label}</b>
                          <span>{c.detail}</span>
                        </span>
                        <span className="check-tag">
                          {c.s === "warn" && c.label.startsWith("Até") ? "Acima do tempo" : STATUS[c.s].tag}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="card" aria-labelledby="specs">
                <h2 id="specs" className="h2">
                  Características
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
                  <p className="hint">
                    Itens citados no anúncio:{" "}
                    {l.amenities
                      .map(
                        (a) => AMENITY_FILTERS.find((x) => x.id === a)?.label ?? (a === "mobiliado" ? "mobiliado" : a),
                      )
                      .join(", ")}
                    .
                  </p>
                )}
              </section>

              {(near.length > 0 || stops.length > 0) && (
                <section className="card" aria-labelledby="near">
                  <h2 id="near" className="h2">
                    Perto daqui, a pé
                  </h2>
                  <ul className="near">
                    {stops.map(({ line, s }) => (
                      <li key={line.id}>
                        <span className="near-icon" style={{ color: line.color }}>
                          <Icon name="bus" size={18} />
                        </span>
                        <span className="grow">
                          Ponto da linha {line.ref ?? line.name}
                          {s!.ns.name ? ` · ${s!.ns.name}` : ""}
                        </span>
                        <span className="muted">{meters(s!.ns.dist)}</span>
                        <b>{walkMin(s!.ns.dist)} min a pé</b>
                      </li>
                    ))}
                    {near.map((n) => (
                      <li key={n.label}>
                        <span className="near-icon">
                          <Icon name={n.icon} size={18} />
                        </span>
                        <span className="grow">{n.label}</span>
                        <span className="muted">~{meters(n.dist)}</span>
                        <b>{walkMin(n.dist)} min a pé</b>
                      </li>
                    ))}
                  </ul>
                  {near.length > 0 && (
                    <p className="hint">
                      Distâncias a partir do centro da quadra analisada, em linha reta com folga para as ruas.
                    </p>
                  )}
                </section>
              )}
            </div>

            <aside className="detail-side">
              <section className="card">
                <span className="hint">{f.basis === "rent" ? "Aluguel por mês" : "Total por mês"}</span>
                <div className="price huge">{price ? money(price) : "Sem preço"}</div>
                <dl className="rows">
                  <div>
                    <dt>Aluguel</dt>
                    <dd>{l.rent ? money(l.rent) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Condomínio</dt>
                    <dd>{l.condo ? money(l.condo) : <span className="muted">não informado</span>}</dd>
                  </div>
                  <div>
                    <dt>IPTU</dt>
                    <dd>{l.iptu ? money(l.iptu) : <span className="muted">não informado</span>}</dd>
                  </div>
                </dl>
                {f.budget && price > 0 && (
                  <div className="budgetbar">
                    <div
                      className="track"
                      role="img"
                      aria-label={`Preço ${money(price)} contra o alvo de ${money(f.budget)}`}
                    >
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
                      <span className="hint">Seu alvo: {money(f.budget)}</span>
                      {price > f.budget ? (
                        <b className="over">
                          {money(price - f.budget)} acima (+{Math.round(((price - f.budget) / f.budget) * 100)}%)
                        </b>
                      ) : (
                        <b className="ok">{money(f.budget - price)} abaixo</b>
                      )}
                    </div>
                  </div>
                )}
                <ExternalLink className="btn primary big block" href={l.url}>
                  Ver anúncio no {sourceName(l)} <Icon name="ext" size={16} />
                </ExternalLink>
                <span className="hint center">Visita e proposta são feitas no site do anúncio.</span>
              </section>

              <section className="card" aria-labelledby="trip">
                <div className="row between">
                  <h2 id="trip" className="h2">
                    Até o trabalho
                  </h2>
                  {cell && <span className="price">{cell.commuteMin} min</span>}
                </div>
                {cell ? (
                  <ol className="trip">
                    {stop && cell.via !== "a pé" && (
                      <li>
                        <span className="trip-dot">
                          <Icon name="walk" size={14} />
                        </span>
                        <span className="grow">
                          <b>Caminhe até o ponto</b>
                          <span>
                            {stop.ns.name ?? `Linha ${stop.line.ref ?? ""}`} · {meters(stop.ns.dist)}
                          </span>
                        </span>
                        <b>{walkMin(stop.ns.dist)} min</b>
                      </li>
                    )}
                    {cell.via !== "a pé" && (
                      <li>
                        <span className="trip-dot">
                          <Icon name="clock" size={14} />
                        </span>
                        <span className="grow">
                          <b>Espere o ônibus</b>
                          <span>Estimativa média{cell.via.includes("+") ? ", em cada ônibus" : ""}</span>
                        </span>
                        <b>~8 min</b>
                      </li>
                    )}
                    <li>
                      <span className="trip-dot bus">
                        <Icon name={cell.via === "a pé" ? "walk" : "bus"} size={14} />
                      </span>
                      <span className="grow">
                        <b>
                          {cell.via === "a pé"
                            ? "Vá a pé"
                            : cell.via.includes("+")
                              ? `Linhas ${shortVia(cell.via)}`
                              : `Linha ${shortVia(cell.via)}`}
                        </b>
                        <span>
                          {cell.via.includes("+")
                            ? "Com uma baldeação"
                            : cell.via === "a pé"
                              ? "Perto o bastante para ir andando"
                              : "Sem baldeação"}
                        </span>
                      </span>
                    </li>
                    <li>
                      <span className="trip-dot end">
                        <Icon name="brief" size={14} />
                      </span>
                      <span className="grow">
                        <b>Trabalho</b>
                        <span>Total estimado de porta a porta</span>
                      </span>
                      <b>{cell.commuteMin} min</b>
                    </li>
                  </ol>
                ) : (
                  <p className="hint">
                    Este imóvel fica fora da área que a análise cobriu, então não há estimativa de trajeto.
                  </p>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
