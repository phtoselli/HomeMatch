import type { SourceInfo } from "@homematch/contracts";
import { safeExternalUrl } from "@homematch/domain";
import { ExternalLink, Icon } from "@/shared/ui";
import type { Search } from "../hooks/useSearch";

const hostOf = (site: string) => {
  const url = safeExternalUrl(site);
  return url ? new URL(url).hostname.replace(/^www\./, "") : site;
};

const STATUS: Record<SourceInfo["status"], string> = {
  ok: "",
  robots: "não permite robôs",
  bloqueado: "bloqueia leitura automática",
  "sem-dados": "falta extensão",
  erro: "fora do ar",
};

/** Resumo de uma linha: em quantos sites a busca acontece. */
export function sourcesSummary(s: Search, cityName?: string): string {
  if (s.loadingSources) return `Procurando imobiliárias${cityName ? ` em ${cityName}` : ""}…`;
  const a = s.available;
  if (!a) return `Buscando em ${s.sources.length} portais.`;
  const on = new Set(s.sources);
  const portals = a.portals.filter((x) => on.has(x.id)).length;
  const agencies = a.agencies.filter((x) => on.has(x.id)).length;
  return `Buscando em ${portals} ${portals === 1 ? "portal" : "portais"}${agencies ? ` e ${agencies} ${agencies === 1 ? "imobiliária" : "imobiliárias"}${a.city ? ` de ${a.city}` : ""}` : ""}.`;
}

function Row({ x, on, onToggle }: { x: SourceInfo; on: boolean; onToggle: () => void }) {
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
      {!ok && <span className="src-tag warn">{STATUS[x.status]}</span>}
      {x.note && <span className="src-note">{x.note}</span>}
    </li>
  );
}

/**
 * Onde a busca acontece: os portais (valem para qualquer cidade) e as imobiliárias achadas na cidade.
 * As que não dá para ler aparecem com o motivo (robots.txt, bloqueio, sem extensão).
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
          <h3 className="src-h">Portais</h3>
          <ul className="src-list">
            {a.portals.map((x) => (
              <Row key={x.id} x={x} on={on.has(x.id)} onToggle={() => toggle(x.id)} />
            ))}
          </ul>
          <h3 className="src-h">
            Imobiliárias {a.city ? `de ${a.city}` : "da cidade"}
            <span className="muted">
              {" "}
              ·{" "}
              {a.agencies.length
                ? `${readable} de ${a.agencies.length} dá para ler`
                : "nenhuma com site no OpenStreetMap"}
            </span>
          </h3>
          {a.agencies.length > 0 ? (
            <ul className="src-list">
              {a.agencies.map((x) => (
                <Row key={x.id} x={x} on={on.has(x.id)} onToggle={() => toggle(x.id)} />
              ))}
            </ul>
          ) : (
            <p className="hint">{a.city ? "Escolha a cidade para procurar as imobiliárias dela." : ""}</p>
          )}
          <p className="hint">
            As imobiliárias vêm do OpenStreetMap (escritórios cadastrados com site). Respeitamos o robots.txt de cada
            site e não contornamos bloqueios.
          </p>
        </>
      )}
    </div>
  );
}
