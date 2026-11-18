import type { BusLine, LatLng, LineTimetable, PlaceResult, TransitOperatorInfo } from "@homematch/contracts";
import type { ParsedRoute } from "@homematch/domain";

/** Official source of a city's bus lines. */
export interface TransitOperator {
  info: TransitOperatorInfo;
  serves(city: Pick<PlaceResult, "osmId" | "name" | "stateCode">): boolean;
  /** By line number ("353", "126,1") or name. One item per direction. */
  findLines(q: string): Promise<BusLine[]>;
  /** By an id returned earlier ("emdec:353:1" or "emdec:353"). */
  lineById(id: string): Promise<BusLine[]>;
  /** Lines with a stop within `radiusM` of the point (both directions of each). */
  linesNear(p: LatLng, radiusM: number, maxLines: number): Promise<BusLine[]>;
  /** The whole network in the analysis format (stops in order, one direction per item). */
  routes(): Promise<ParsedRoute[]>;
  /** The line's timetable (null when the operator does not publish one). */
  timetable?(ref: string): Promise<LineTimetable | null>;
}
