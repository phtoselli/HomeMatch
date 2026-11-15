import { REGION_LEVELS } from "@homematch/contracts/constants";
import type { BusLine, FeatureDef, RegionLevel } from "@homematch/contracts";
import { LEVEL_LABEL, atLeast, meters } from "@homematch/domain";
import { LEVEL_COLOR } from "@/shared/lib/format";
import { FEATURE_ICON, Icon } from "@/shared/ui";
import type { MapSettings } from "../model/settings";

interface Props {
  settings: MapSettings;
  hasWork: boolean;
  hasAnalysis: boolean;
  minLevel: RegionLevel;
  /** A análise tem trecho intermunicipal estimado (pontilhado no mapa). */
  estimatedLeg?: boolean;
  busLines: BusLine[];
  /** Características pedidas (o que a pessoa quer perto) e o raio de cada uma. */
  features: FeatureDef[];
  chosen: Record<string, number>;
}

/** Legenda do mapa: trabalho, nota das regiões, linhas que a pessoa pôs e lugares pedidos. */
export function Legend({
  settings: s,
  hasWork,
  hasAnalysis,
  minLevel,
  estimatedLeg,
  busLines,
  features,
  chosen,
}: Props) {
  const lineRefs = s.myLines ? [...new Map(busLines.map((l) => [l.ref ?? l.name, l.color])).entries()].slice(0, 3) : [];
  const pois = s.pois ? features.filter((d) => !s.hiddenPois.includes(d.id)) : [];

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
          <span>Nível da região</span>
          <span className="lg-levels">
            {[...REGION_LEVELS]
              .reverse()
              .filter((l) => atLeast(l, minLevel))
              .map((l) => (
                <span key={l}>
                  <span className="lg-swatch" style={{ background: LEVEL_COLOR[l] }} />
                  {LEVEL_LABEL[l]}
                </span>
              ))}
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
