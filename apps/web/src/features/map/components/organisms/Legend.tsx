import type { CSSProperties } from "react";
import { REGION_LEVELS } from "@homematch/contracts/constants";
import type { BusLine, FeatureDef, RegionLevel } from "@homematch/contracts";
import { atLeast, levelLabel, meters } from "@homematch/domain";
import { t } from "@homematch/i18n";
import { LEVEL_COLOR, shortLabel } from "@/shared/lib/format";
import { FEATURE_ICON, Icon } from "@/shared/ui";
import type { MapSettings } from "../../model/settings";

interface Props {
  settings: MapSettings;
  hasWork: boolean;
  hasAnalysis: boolean;
  minLevel: RegionLevel;
  /** The analysis has an estimated intercity leg (dotted on the map). */
  estimatedLeg?: boolean;
  busLines: BusLine[];
  /** Requested features (what the user wants nearby) and the radius of each. */
  features: FeatureDef[];
  chosen: Record<string, number>;
}

/** Map legend: work, region levels, lines the user added and requested places. */
const msg = t.ui.legend;

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
    <div className="legend" aria-label={msg.legend}>
      <b>{msg.legend}</b>
      {hasWork && (
        <span>
          <span className="lg-work">
            <Icon name="brief" size={11} />
          </span>
          {msg.work}
        </span>
      )}
      {hasAnalysis && s.cells && (
        <span className="lg-col">
          <span>{msg.regionLevel}</span>
          <span className="lg-levels">
            {[...REGION_LEVELS]
              .reverse()
              .filter((l) => atLeast(l, minLevel))
              .map((l) => (
                <span key={l}>
                  <span className="lg-swatch" data-level={l} style={{ "--c": LEVEL_COLOR[l] } as CSSProperties} />
                  {levelLabel(l)}
                </span>
              ))}
          </span>
        </span>
      )}
      {hasAnalysis && estimatedLeg && s.routes && (
        <span>
          <span className="lg-line dotted" />
          {msg.estimatedIntercity}
        </span>
      )}
      {lineRefs.map(([ref, color]) => (
        <span key={ref}>
          <span className="lg-line" style={{ background: color }} />
          {t.transit.lineName(ref)}
        </span>
      ))}
      {hasAnalysis &&
        pois.map((d) => (
          <span key={d.id}>
            <span className="lg-poi" style={{ background: d.color }}>
              <Icon name={FEATURE_ICON[d.id] ?? "pin"} size={11} />
            </span>
            {shortLabel(d.label)}
            <span className="muted">{msg.upTo(meters(chosen[d.id]!))}</span>
          </span>
        ))}
    </div>
  );
}
