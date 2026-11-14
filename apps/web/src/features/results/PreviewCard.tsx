import type { BusLine, Listing } from "@homematch/contracts";
import { meters, money, nearestStop, priceOf, walkMin, type Filters, type Ranked } from "@homematch/domain";
import { Icon } from "../../shared/ui/Icon";
import { sourceName } from "../../shared/lib/format";
import { MatchBadge, overBudget, shortVia, specsLine } from "./ListingBits";
import { Photo } from "../../shared/ui/Photo";

/** Parada mais perto entre as linhas mostradas no mapa (prefere a que o trajeto usa). */
export function bestStop(l: Listing, lines: BusLine[], via?: string) {
  const all = lines
    .map((line) => ({ line, ns: nearestStop(line, l) }))
    .filter((x): x is { line: BusLine; ns: NonNullable<ReturnType<typeof nearestStop>> } => !!x.ns)
    .sort((a, b) => a.ns.dist - b.ns.dist);
  const used = via ? all.find((x) => x.line.ref && shortVia(via).split(" + ").includes(x.line.ref)) : undefined;
  return used ?? all[0];
}

interface Props {
  item: Ranked;
  filters: Filters;
  busLines: BusLine[];
  onOpen: () => void;
  onClose: () => void;
  fav: boolean;
  onToggleFav: () => void;
}

/** Cartão do imóvel selecionado, por cima do mapa. */
export function PreviewCard({ item: { l, cell, match }, filters, busLines, onOpen, onClose, fav, onToggleFav }: Props) {
  const price = priceOf(l, filters.basis);
  const over = overBudget(l, filters);
  const stop = bestStop(l, busLines, cell?.via);
  return (
    <article className="preview" aria-label="Imóvel selecionado">
      <button type="button" className="preview-close" aria-label="Fechar prévia" onClick={onClose}>
        <Icon name="x" size={16} />
      </button>
      <Photo className="preview-photo" src={l.image} label="Sem foto no anúncio" />
      <div className="preview-body">
        <div className="lcard-top">
          <span className="price big">
            {price ? money(price) : "Sem preço"}
            <small> /mês</small>
          </span>
          <MatchBadge value={match} />
        </div>
        {over != null && <span className="over">+{money(over)} acima do seu alvo</span>}
        <span className="lcard-title">{specsLine(l)}</span>
        <span className="lcard-sub">{l.region ?? l.address}</span>
        <div className="trip-mini">
          {stop && (
            <>
              <span>
                <Icon name="walk" size={14} /> {walkMin(stop.ns.dist)} min
              </span>
              <Icon name="chevR" size={12} />
              <span className="line-tag" style={{ background: stop.line.color }}>
                {stop.line.ref ?? "Linha"}
              </span>
              <span className="muted">ponto a {meters(stop.ns.dist)}</span>
            </>
          )}
          {!stop && cell && (
            <span>
              <Icon name={cell.via === "a pé" ? "walk" : "bus"} size={14} />{" "}
              {cell.via === "a pé" ? "a pé" : shortVia(cell.via)}
            </span>
          )}
          {cell ? (
            <b className="trip-total">{cell.commuteMin} min até o trabalho</b>
          ) : (
            <span className="muted">Fora da área analisada</span>
          )}
        </div>
        <div className="row">
          <button type="button" className="btn primary grow" onClick={onOpen}>
            Ver detalhes
          </button>
          <button
            type="button"
            className="btn fav-inline"
            aria-pressed={fav}
            aria-label={fav ? "Tirar dos favoritos" : "Favoritar"}
            title={fav ? "Tirar dos favoritos" : "Favoritar"}
            onClick={onToggleFav}
          >
            <Icon name="heart" size={16} />
          </button>
          <a className="btn" href={l.url} target="_blank" rel="noopener">
            {sourceName(l, "Anúncio")} <Icon name="ext" size={15} />
          </a>
        </div>
      </div>
    </article>
  );
}
