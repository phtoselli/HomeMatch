import { useState } from "react";
import type { BBox, BusLine, City, LatLng, LinkResult } from "../../shared/types";
import { api } from "../api";
import { meters, money, nearestStop, walkMin } from "../format";
import { SOURCE_LABEL } from "../MapView";

interface Props {
  city: City | null;
  work: LatLng | null;
  viewBBox: BBox | null;
  results: LinkResult[];
  setResults: (r: LinkResult[] | ((p: LinkResult[]) => LinkResult[])) => void;
  lines: BusLine[];
  setLines: (l: BusLine[] | ((p: BusLine[]) => BusLine[])) => void;
  onFit: (b: BBox) => void;
  onFocusListing: (id: string) => void;
}

function bboxOfPoints(pts: LatLng[]): BBox {
  return {
    south: Math.min(...pts.map((p) => p.lat)),
    north: Math.max(...pts.map((p) => p.lat)),
    west: Math.min(...pts.map((p) => p.lng)),
    east: Math.max(...pts.map((p) => p.lng)),
  };
}

export function LinksPanel(p: Props) {
  const [text, setText] = useState("");
  const [busQ, setBusQ] = useState("");
  const [busy, setBusy] = useState<"links" | "bus" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addLinks() {
    const urls = [...new Set(text.split(/[\s,;]+/).filter((u) => /^https?:\/\//i.test(u)))];
    const known = new Set(p.results.map((r) => r.url));
    const fresh = urls.filter((u) => !known.has(u));
    if (!fresh.length) {
      setError(urls.length ? "Esses links já estão no mapa." : "Cole pelo menos um link começando com http.");
      return;
    }
    setBusy("links");
    setError(null);
    const offset = p.results.length;
    try {
      const out = await api.links({ urls: fresh, cityBBox: p.city?.bbox }, (ev) => {
        if (ev.type === "progress") setMsg(ev.message);
        if (ev.type === "partial") p.setResults((prev) => [...prev, ...ev.data.map((r) => ({ ...r, index: r.index + offset }))]);
      });
      const pts = out.filter((r) => r.listing).map((r) => r.listing!);
      if (pts.length) p.onFit(bboxOfPoints([...pts, ...p.results.filter((r) => r.listing).map((r) => r.listing!)]));
      setText("");
      setMsg(`${pts.length} de ${out.length} link(s) marcados no mapa.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addBus() {
    const q = busQ.trim();
    if (!q) return;
    setBusy("bus");
    setError(null);
    setMsg("Procurando a linha no OpenStreetMap… (a primeira busca pode levar ~1 min)");
    try {
      const box = p.city?.bbox ?? p.viewBBox ?? undefined;
      const found = await api.bus(q, box);
      if (!found.length) {
        setError(`Não achei a linha "${q}" ${p.city ? `em ${p.city.name}` : "nesta área do mapa"}. Tente o número com a variante (ex.: 875A-10) ou o link da linha no OpenStreetMap.`);
        setMsg(null);
        return;
      }
      const have = new Set(p.lines.map((l) => l.id));
      const add = found.filter((l) => !have.has(l.id));
      p.setLines((prev) => [...prev, ...add]);
      const pts = found.flatMap((l) => l.segments.flat().map(([lat, lng]) => ({ lat, lng })));
      p.onFit(bboxOfPoints(pts));
      setMsg(`${found.length} sentido(s)/variante(s) encontrados para "${q}".`);
      setBusQ("");
    } catch (e) {
      setError((e as Error).message);
      setMsg(null);
    } finally {
      setBusy(null);
    }
  }

  const ok = p.results.filter((r) => r.listing);

  return (
    <>
      <section className="step">
        <h2><span className="num">A</span>Seus anúncios</h2>
        <p className="hint">
          Cole links de anúncios (QuintoAndar, VivaReal ou site de imobiliária), um por linha. Cada um vira um ícone numerado no mapa.
        </p>
        <textarea
          rows={5}
          value={text}
          placeholder={"https://www.quintoandar.com.br/imovel/…\nhttps://www.vivareal.com.br/imovel/…"}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row">
          <button className="primary" disabled={busy !== null || !text.trim()} onClick={addLinks}>
            {busy === "links" ? <><span className="spinner" /> Lendo links…</> : "📍 Marcar no mapa"}
          </button>
          {p.results.length > 0 && (
            <button className="ghost" onClick={() => p.setResults([])}>Limpar</button>
          )}
        </div>
        {p.results.length > 0 && (
          <ul className="mylinks">
            {p.results.map((r) => {
              const l = r.listing;
              return (
                <li key={r.index} className={l ? "" : "fail"} onClick={() => l && p.onFocusListing(l.id)}>
                  <span className="idx">{r.index}</span>
                  <div className="mlbody">
                    {l ? (
                      <>
                        <div className="ltitle">
                          {l.rent ? <b>{money(l.total)}</b> : <i>sem preço</i>} · {l.typeLabel}
                          {l.area ? ` · ${l.area} m²` : ""}{l.bedrooms ? ` · ${l.bedrooms} qto` : ""}
                        </div>
                        <div className="lmeta">
                          {SOURCE_LABEL[l.source]} · {l.address ?? l.title}
                          {l.approxLocation && <span className="tag">aprox.</span>}
                        </div>
                        {p.lines.map((line) => {
                          const ns = nearestStop(line, l);
                          return (
                            <div key={line.id} className="lmeta">
                              <span className="swatch" style={{ background: line.color }} />
                              {line.ref ?? line.name}:{" "}
                              {ns ? `parada a ${meters(ns.dist)} (~${walkMin(ns.dist)} min a pé)` : "longe (> 3 km)"}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        <div className="ltitle">Não consegui marcar</div>
                        <div className="lmeta">{r.error}</div>
                      </>
                    )}
                    <a className="lmeta url" href={r.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>{r.url}</a>
                  </div>
                  <button
                    className="x"
                    title="Remover"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.setResults((prev) => prev.filter((x) => x.index !== r.index));
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {ok.length > 0 && <p className="hint">{ok.length} no mapa. Os marcados como "aprox." foram posicionados pelo endereço do anúncio.</p>}
      </section>

      <section className="step">
        <h2><span className="num">B</span>Linha de ônibus / metrô</h2>
        <p className="hint">
          Número da linha (ex.: <code>875A-10</code>, <code>609F</code>, <code>Linha 4</code>) ou um link: itinerário da SPTrans
          (<code>…?cdp=…</code>), relação do OpenStreetMap ou Moovit. O trajeto é desenhado rua por rua com as paradas.
        </p>
        <div className="row">
          <input
            value={busQ}
            placeholder="Número ou link da linha"
            onChange={(e) => setBusQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBus()}
          />
          <button className="primary" disabled={busy !== null || !busQ.trim()} onClick={addBus}>
            {busy === "bus" ? <span className="spinner" /> : "🚌 Mostrar"}
          </button>
        </div>
        {!p.city && <p className="hint">Sem cidade escolhida, a busca usa a área visível do mapa.</p>}
        {p.lines.length > 0 && (
          <ul className="buslines">
            {p.lines.map((l) => (
              <li key={l.id}>
                <span className="swatch big" style={{ background: l.color }} />
                <button
                  className="link"
                  onClick={() => p.onFit(bboxOfPoints(l.segments.flat().map(([lat, lng]) => ({ lat, lng }))))}
                >
                  <b>{l.ref ?? ""}</b> {l.name}
                  <span className="lmeta">
                    {l.from && l.to ? `${l.from} → ${l.to} · ` : ""}{l.stops.length} paradas{l.operator ? ` · ${l.operator}` : ""}
                    {p.work && (() => {
                      const ns = nearestStop(l, p.work);
                      return ns ? ` · 💼 parada a ${meters(ns.dist)} do trabalho` : " · 💼 não passa perto do trabalho";
                    })()}
                  </span>
                </button>
                <button className="x" title="Remover" onClick={() => p.setLines((prev) => prev.filter((x) => x.id !== l.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(msg || error) && (
        <div className="log">
          {msg && <div>{msg}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </>
  );
}
