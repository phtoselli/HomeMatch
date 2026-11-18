import { useState } from "react";
import type { BBox, BusLine, City, LatLng, LinkResult, TransitOperatorInfo } from "@homematch/contracts";
import { meters, money, nearestStop, walkMin } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { api } from "@/shared/api/client";
import { ExternalLink, Icon, Spinner } from "@/shared/ui";
import { sourceName } from "@/shared/lib/format";

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
  operator: TransitOperatorInfo | null;
}

const msg = t.ui.links;

function bboxOfPoints(pts: LatLng[]): BBox {
  return {
    south: Math.min(...pts.map((p) => p.lat)),
    north: Math.max(...pts.map((p) => p.lat)),
    west: Math.min(...pts.map((p) => p.lng)),
    east: Math.max(...pts.map((p) => p.lng)),
  };
}

/** Pasted listing links and bus lines added by number or link. */
export function LinksPanel(p: Props) {
  const [text, setText] = useState("");
  const [busQ, setBusQ] = useState("");
  const [busy, setBusy] = useState<"links" | "bus" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addLinks() {
    const urls = [...new Set(text.split(/[\s,;]+/).filter((u) => /^https?:\/\//i.test(u)))];
    const known = new Set(p.results.map((r) => r.url));
    const fresh = urls.filter((u) => !known.has(u));
    if (!fresh.length) {
      setError(urls.length ? msg.alreadyOnMap : msg.pasteAtLeastOne);
      return;
    }
    setBusy("links");
    setError(null);
    const offset = p.results.length;
    try {
      const out = await api.links({ urls: fresh, cityBBox: p.city?.bbox }, (ev) => {
        if (ev.type === "progress") setNotice(ev.message);
        if (ev.type === "partial")
          p.setResults((prev) => [...prev, ...ev.data.map((r) => ({ ...r, index: r.index + offset }))]);
      });
      const pts = out.filter((r) => r.listing).map((r) => r.listing!);
      if (pts.length) p.onFit(bboxOfPoints([...pts, ...p.results.filter((r) => r.listing).map((r) => r.listing!)]));
      setText("");
      setNotice(msg.marked(pts.length, out.length));
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
    setNotice(p.operator ? msg.lookingOnOperator(p.operator.name) : msg.lookingOnOsm);
    try {
      const box = p.city?.bbox ?? p.viewBBox ?? undefined;
      const found = await api.bus(q, box, p.city, p.work);
      if (!found.length) {
        setError(msg.lineNotFound(q, p.city?.name));
        setNotice(null);
        return;
      }
      const have = new Set(p.lines.map((l) => l.id));
      const add = found.filter((l) => !have.has(l.id));
      p.setLines((prev) => [...prev, ...add]);
      const pts = found.flatMap((l) => l.segments.flat().map(([lat, lng]) => ({ lat, lng })));
      p.onFit(bboxOfPoints(pts));
      setNotice(msg.variantsFound(found.length, q));
      setBusQ("");
    } catch (e) {
      setError((e as Error).message);
      setNotice(null);
    } finally {
      setBusy(null);
    }
  }

  async function nearWork() {
    if (!p.city || !p.work) return;
    setBusy("bus");
    setError(null);
    setNotice(p.operator ? msg.nearWorkOnOperator(p.operator.name) : msg.nearWorkOnOsm);
    try {
      const found = await api.busNear(p.work, p.city);
      if (!found.length) {
        setError(msg.noLineNearWork);
        setNotice(null);
        return;
      }
      p.setLines((prev) => [...prev.filter((l) => !found.some((f) => f.id === l.id)), ...found]);
      const refs = [...new Set(found.map((l) => l.ref ?? l.name))];
      setNotice(msg.linesNearWork(refs));
      p.onFit(bboxOfPoints(found.flatMap((l) => l.segments.flat().map(([lat, lng]) => ({ lat, lng })))));
    } catch (e) {
      setError((e as Error).message);
      setNotice(null);
    } finally {
      setBusy(null);
    }
  }

  const ok = p.results.filter((r) => r.listing);

  return (
    <>
      <section className="step">
        <h2>
          <span className="num">A</span>
          {msg.yourListings}
        </h2>
        <p className="hint">{msg.pasteHint}</p>
        <textarea
          rows={5}
          value={text}
          placeholder={"https://www.quintoandar.com.br/imovel/…\nhttps://www.vivareal.com.br/imovel/…"}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row">
          <button className="primary" disabled={busy !== null || !text.trim()} onClick={addLinks}>
            {busy === "links" ? (
              <>
                <Spinner /> {msg.reading}
              </>
            ) : (
              <>
                <Icon name="pin" /> {msg.markOnMap}
              </>
            )}
          </button>
          {p.results.length > 0 && (
            <button className="ghost" onClick={() => p.setResults([])}>
              {msg.clear}
            </button>
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
                          {l.rent ? <b>{money(l.total)}</b> : <i>{msg.noPrice}</i>} · {l.typeLabel}
                          {l.area ? ` · ${l.area} m²` : ""}
                          {l.bedrooms ? ` · ${msg.bedroomsShort(l.bedrooms)}` : ""}
                        </div>
                        <div className="lmeta">
                          {sourceName(l)} · {l.address ?? l.title}
                          {l.approxLocation && <span className="tag">{msg.approx}</span>}
                        </div>
                        {p.lines.map((line) => {
                          const ns = nearestStop(line, l);
                          return (
                            <div key={line.id} className="lmeta">
                              <span className="swatch" style={{ background: line.color }} />
                              {line.ref ?? line.name}:{" "}
                              {ns ? msg.stopAt(meters(ns.dist), walkMin(ns.dist)) : msg.farFromLine}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        <div className="ltitle">{msg.couldNotMark}</div>
                        <div className="lmeta">{r.error}</div>
                      </>
                    )}
                    <ExternalLink className="lmeta url" href={r.url} onClick={(e) => e.stopPropagation()}>
                      {r.url}
                    </ExternalLink>
                  </div>
                  <button
                    className="x"
                    title={msg.remove}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.setResults((prev) => prev.filter((x) => x.index !== r.index));
                    }}
                  >
                    <Icon name="x" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {ok.length > 0 && <p className="hint">{msg.onMapSummary(ok.length)}</p>}
      </section>

      <section className="step">
        <h2>
          <span className="num">B</span>
          {msg.busLine}
        </h2>
        <p className="hint">
          {msg.lineHintBefore} <code>875A-10</code>, <code>609F</code>, <code>Linha 4</code>) {msg.lineHintMiddle} (
          <code>…?cdp=…</code>){msg.lineHintAfter}
        </p>
        <div className="row">
          <input
            value={busQ}
            placeholder={msg.linePlaceholder}
            onChange={(e) => setBusQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBus()}
          />
          <button className="primary" disabled={busy !== null || !busQ.trim()} onClick={addBus}>
            {busy === "bus" ? (
              <Spinner />
            ) : (
              <>
                <Icon name="bus" /> {msg.show}
              </>
            )}
          </button>
        </div>
        {!p.city && <p className="hint">{msg.noCity}</p>}
        {p.city && (
          <>
            <p className="hint">
              {p.operator ? (
                <>
                  {msg.officialSourceBefore(p.city.name)} <b>{p.operator.name}</b>
                  {msg.officialSourceAfter}
                </>
              ) : (
                msg.osmSource(p.city.name)
              )}
            </p>
            <button className="ghost" disabled={busy !== null || !p.work} onClick={nearWork}>
              <Icon name="search" /> {msg.linesNearWorkButton(!p.work)}
            </button>
          </>
        )}
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
                  {l.direction ? <small> · {msg.direction(l.direction)}</small> : null}
                  <span className="lmeta">
                    {l.from && l.to ? `${l.from} → ${l.to} · ` : ""}
                    {msg.stops(l.stops.length)}
                    {l.operator ? ` · ${l.operator}` : ""}
                    {l.website && l.source && l.source !== "osm" && (
                      <>
                        {" "}
                        ·{" "}
                        <ExternalLink href={l.website} onClick={(e) => e.stopPropagation()}>
                          {msg.officialMap}
                        </ExternalLink>
                      </>
                    )}
                    {p.work &&
                      (() => {
                        const ns = nearestStop(l, p.work);
                        return ns ? ` · ${msg.stopFromWork(meters(ns.dist))}` : ` · ${msg.notNearWork}`;
                      })()}
                  </span>
                </button>
                <button
                  className="x"
                  title={msg.remove}
                  aria-label={msg.removeLine}
                  onClick={() => p.setLines((prev) => prev.filter((x) => x.id !== l.id))}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(notice || error) && (
        <div className="log">
          {notice && <div>{notice}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </>
  );
}
