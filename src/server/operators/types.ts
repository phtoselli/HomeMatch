import type { BusLine, LatLng, LineTimetable, PlaceResult, TransitOperatorInfo } from "../../shared/types.js";
import type { ParsedRoute } from "../transit.js";

/** Fonte oficial das linhas de ônibus de uma cidade (o "representante" das linhas). */
export interface TransitOperator {
  info: TransitOperatorInfo;
  serves(city: Pick<PlaceResult, "osmId" | "name" | "stateCode">): boolean;
  /** Pelo número ("353", "126,1") ou nome da linha. Um item por sentido. */
  findLines(q: string): Promise<BusLine[]>;
  /** Pelo id devolvido antes ("emdec:353:1" ou "emdec:353"). */
  lineById(id: string): Promise<BusLine[]>;
  /** Linhas com parada a até `radiusM` do ponto (os dois sentidos de cada uma). */
  linesNear(p: LatLng, radiusM: number, maxLines: number): Promise<BusLine[]>;
  /** Rede inteira no formato da análise (paradas em ordem, um sentido por item). */
  routes(): Promise<ParsedRoute[]>;
  /** Grade de horários da linha (null se o operador não publica). */
  timetable?(ref: string): Promise<LineTimetable | null>;
}
