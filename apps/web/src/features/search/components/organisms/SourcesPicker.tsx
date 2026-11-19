import { useState } from "react";
import type { SourceInfo } from "@homematch/contracts";
import { safeExternalUrl } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { ExternalLink, Icon } from "@/shared/ui";
import type { Search } from "../../hooks/useSearch";

const msg = t.ui.sources;

const hostOf = (site: string) => {
  const url = safeExternalUrl(site);
  return url ? new URL(url).hostname.replace(/^www\./, "") : site;
};

/** One-line summary: how many sites the search runs on. */
export function sourcesSummary(s: Search, cityName?: string): string {
  if (s.loadingSources) return msg.lookingForAgencies(cityName);
  const a = s.available;
  if (!a) return msg.searchingPortals(s.sources.length);
  const on = new Set(s.sources);
  const portals = a.portals.filter((x) => on.has(x.id)).length;
  const agencies = a.agencies.filter((x) => on.has(x.id)).length;
  return msg.searchingIn(portals, agencies, a.city);
}

function Row({
  x,
  on,
  onToggle,
  onRemove,
}: {
  x: SourceInfo;
  on: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const ok = x.status === "ok";
  return (
    <li className="src-row" data-off={!ok || undefined}>
      <label className="check">
        <input type="checkbox" disabled={!ok} checked={ok && on} onChange={onToggle} />
        <span className="src-name">{x.label}</span>
      </label>
      <ExternalLink className="src-site" href={x.site} title={x.site}>
        {hostOf(x.site)} <Icon name="ext" size={12} />
      </ExternalLink>
      {x.platform && <span className="src-tag">{x.platform}</span>}
      {!ok && <span className="src-tag warn">{msg.status[x.status]}</span>}
      {onRemove && (
        <button type="button" className="src-tag link" onClick={onRemove} aria-label={msg.removeAgency(x.label)}>
          {msg.addedByYou} ✕
        </button>
      )}
      {x.note && <span className="src-note">{x.note}</span>}
    </li>
  );
}

/** Field to add an agency's website the search does not know yet. */
function AddAgency({ s }: { s: Search }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const add = () => {
    const raw = value.trim();
    const url = safeExternalUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url ? new URL(url).hostname : "";
    if (!url || !host.includes(".")) return setError(true);
    s.addAgency(new URL(url).origin);
    setValue("");
    setError(false);
  };
  return (
    <form
      className="src-add"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label className="hint" htmlFor="src-add-input">
        {msg.addAgency}
      </label>
      <div className="row">
        <input
          id="src-add-input"
          type="text"
          inputMode="url"
          value={value}
          placeholder={msg.addAgencyPlaceholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
        />
        <button type="submit" disabled={!value.trim()}>
          {msg.addAgencyButton}
        </button>
      </div>
      {error && <span className="hint warn">{msg.invalidSite}</span>}
      {s.loadingSources && s.extraAgencies.length > 0 && <span className="hint">{msg.checkingSite}</span>}
    </form>
  );
}

/**
 * Where the search runs: the portals (valid for any city) and the agencies found in the city.
 * Those that cannot be read show the reason (robots.txt, blocking, missing extension).
 */
export function SourcesPicker({ s, cityName }: { s: Search; cityName?: string }) {
  const a = s.available;
  const on = new Set(s.sources);
  const toggle = (id: string) => s.setSourceEnabled(id, !on.has(id));
  const readable = a?.agencies.filter((x) => x.status === "ok").length ?? 0;
  return (
    <div className="sources">
      <span className="hint">{sourcesSummary(s, cityName)}</span>
      {a && (
        <>
          <h3 className="src-h">{msg.portals}</h3>
          <ul className="src-list">
            {a.portals.map((x) => (
              <Row key={x.id} x={x} on={on.has(x.id)} onToggle={() => toggle(x.id)} />
            ))}
          </ul>
          <h3 className="src-h">
            {msg.agenciesOf(a.city)}
            <span className="muted">
              {" "}
              · {a.agencies.length ? msg.readableOf(readable, a.agencies.length) : msg.noAgencies}
            </span>
          </h3>
          {a.agencies.length > 0 ? (
            <ul className="src-list">
              {a.agencies.map((x) => {
                const added = s.extraAgencies.find((site) => hostOf(site) === hostOf(x.site));
                return (
                  <Row
                    key={x.id}
                    x={x}
                    on={on.has(x.id)}
                    onToggle={() => toggle(x.id)}
                    onRemove={added ? () => s.removeAgency(added) : undefined}
                  />
                );
              })}
            </ul>
          ) : (
            <p className="hint">{a.city ? "" : msg.chooseCity}</p>
          )}
          {a.city && <AddAgency s={s} />}
          <p className="hint">{msg.disclaimer}</p>
        </>
      )}
    </div>
  );
}
