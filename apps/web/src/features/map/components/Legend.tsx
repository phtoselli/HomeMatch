import type { BusLine, FeatureDef } from "@homematch/contracts";
import { meters } from "@homematch/domain";
import { FEATURE_ICON, Icon } from "@/shared/ui";
import type { MapSettings } from "../model/settings";

interface Props {
  settings: MapSettings;
  hasWork: boolean;
  hasAnalysis: boolean;
  /** A análise tem trecho intermunicipal estimado (pontilhado no mapa). */
  estimatedLeg?: boolean;
  busLines: BusLine[];
  /** Características pedidas (o que a pessoa quer perto) e o raio de cada uma. */
  features: FeatureDef[];
  chosen: Record<string, number>;
}

const CELL_ENDS = { great: ["ótima", "a melhor"], ok: ["ok", "boa"], both: ["ok", "ótima"] } as const;

/** Legenda do mapa: trabalho, nota das regiões, linhas que a pessoa pôs e lugares pedidos. */
export function Legend({ settings: s, hasWork, hasAnalysis, estimatedLeg, busLines, features, chosen }: Props) {
  const lineRefs = s.myLines ? [...new Map(busLines.map((l) => [l.ref ?? l.name, l.color])).entries()].slice(0, 3) : [];
  const pois = s.pois ? features.filter((d) => !s.hiddenPois.includes(d.id)) : [];
  const ends = CELL_ENDS[s.cellBand];
  const band = s.cellBand === "great" ? " (só as ótimas)" : s.cellBand === "ok" ? " (só as ok)" : "";

  return (
    <div className="legend" aria-label="Legenda">
      <b>Legenda</b>
      {hasWork && (
        <span>
          <span className="lg-work">
            <Icon name="brief" size={11} />
          </span>
          Trabalho
        </span>
      )}
      {hasAnalysis && s.cells && (
        <span className="lg-col">
          <span>Nota da região{band}</span>
          <span className={`lg-bar ${s.cellBand}`} />
          <span className="lg-ends">
            <span>{ends[0]}</span>
            <span>{ends[1]}</span>
          </span>
        </span>
      )}
      {hasAnalysis && estimatedLeg && s.routes && (
        <span>
          <span className="lg-line dotted" />
          Intermunicipal (estimado)
        </span>
      )}
      {lineRefs.map(([ref, color]) => (
        <span key={ref}>
          <span className="lg-line" style={{ background: color }} />
          Linha {ref}
        </span>
      ))}
      {hasAnalysis &&
        pois.map((d) => (
          <span key={d.id}>
            <span className="lg-poi" style={{ background: d.color }}>
              <Icon name={FEATURE_ICON[d.id] ?? "pin"} size={11} />
            </span>
            {d.label.split(" / ")[0]}
            <span className="muted">até {meters(chosen[d.id]!)}</span>
          </span>
        ))}
    </div>
  );
}
