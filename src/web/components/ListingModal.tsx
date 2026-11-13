import { useEffect } from "react";
import type { BusLine, Cell, LatLng, Listing } from "../../shared/types";
import { PROPERTY_TYPE_LABEL } from "../../shared/types";
import { distM, meters, money, nearestStop, walkMin } from "../format";
import { SOURCE_LABEL } from "../MapView";
import { AMENITY_TAG } from "./ExplorePanel";
import { Photo } from "./Photo";

interface Props {
  listing: Listing;
  cell?: Cell | null;
  work: LatLng | null;
  busLines: BusLine[];
  onClose: () => void;
}

/** Detalhes do imóvel clicado no mapa ou na lista, com o link para o anúncio original. */
export function ListingModal({ listing: l, cell, work, busLines, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const specs: [string, string][] = [
    ["Tipo", l.typeLabel || PROPERTY_TYPE_LABEL[l.type]],
    ...(l.area ? [["Área", `${l.area} m²`] as [string, string]] : []),
    ...(l.bedrooms != null ? [["Quartos", String(l.bedrooms)] as [string, string]] : []),
    ...(l.bathrooms != null ? [["Banheiros", String(l.bathrooms)] as [string, string]] : []),
    ...(l.parking != null ? [["Vagas", String(l.parking)] as [string, string]] : []),
    ...(l.furnished != null ? [["Mobiliado", l.furnished ? "sim" : "não"] as [string, string]] : []),
  ];
  const stops = busLines
    .map((line) => ({ line, ns: nearestStop(line, l) }))
    .filter((x) => x.ns)
    .sort((a, b) => a.ns!.dist - b.ns!.dist)
    .filter((x, i, arr) => arr.findIndex((y) => y.line.ref === x.line.ref) === i); // um sentido por linha

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={l.title} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
        <Photo key={l.id} className="modal-img" src={l.image} />
        <div className="modal-body">
          <div className="modal-src">{SOURCE_LABEL[l.source] ?? l.source}{l.region ? ` · ${l.region}` : ""}</div>
          <div className="modal-price">
            {l.rent ? (
              <>
                {money(l.total)} <small>{l.total > l.rent ? "por mês, total" : "por mês"}</small>
              </>
            ) : (
              <small>Preço não informado na página</small>
            )}
          </div>
          {l.rent > 0 && l.total > l.rent && (
            <div className="modal-breakdown">
              Aluguel {money(l.rent)}
              {l.condo ? ` · condomínio ${money(l.condo)}` : ""}
              {l.iptu ? ` · IPTU ${money(l.iptu)}` : ""}
              {!l.condo && !l.iptu ? ` · taxas ${money(l.total - l.rent)}` : ""}
            </div>
          )}

          <dl className="modal-specs">
            {specs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {l.amenities && l.amenities.length > 0 && (
            <div className="modal-tags">{l.amenities.map((a) => <span key={a} className="tag">{AMENITY_TAG[a] ?? a}</span>)}</div>
          )}

          <div className="modal-addr">
            📍 {l.address || l.title}
            {l.approxLocation && <em> (posição aproximada pelo endereço)</em>}
          </div>

          {(cell || work || stops.length > 0) && (
            <div className="modal-commute">
              {cell && <div>🚌 ~{cell.commuteMin} min até o trabalho · {cell.via}</div>}
              {!cell && work && <div>💼 {meters(distM(l, work))} do trabalho em linha reta</div>}
              {stops.slice(0, 4).map(({ line, ns }) => (
                <div key={line.id}>
                  🚏 <b>{line.ref ?? line.name}</b>: parada a {meters(ns!.dist)} (~{walkMin(ns!.dist)} min a pé){ns!.name ? ` · ${ns!.name}` : ""}
                </div>
              ))}
            </div>
          )}

          <a className="primary modal-link" href={l.url} target="_blank" rel="noopener">
            Ver anúncio no {SOURCE_LABEL[l.source] ?? "site"} ↗
          </a>
          <div className="modal-title">{l.title}</div>
        </div>
      </div>
    </div>
  );
}
