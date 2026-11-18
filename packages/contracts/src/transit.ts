import { z } from "zod";
import { t } from "@homematch/i18n";
import { latLngTupleSchema } from "./geo.js";
import { TRANSIT_MODES } from "./constants.js";

export const transitModeSchema = z.enum(TRANSIT_MODES);

/**
 * Role of a line in the analysis: stops near work, connects both cities (intercity), estimated leg (intercity
 * without a mapped line) or only feeds one of those (transfer).
 */
export const ROUTE_KINDS = ["nearWork", "intercity", "estimated", "feeder"] as const;
export const routeKindSchema = z.enum(ROUTE_KINDS);
export type RouteKind = z.infer<typeof routeKindSchema>;

/** A line the analysis uses to reach work. */
export const transitRouteSchema = z.object({
  /** OSM relation id or "<operator>:<line>:<direction>". */
  id: z.string(),
  ref: z.string().optional(),
  name: z.string(),
  mode: transitModeSchema,
  color: z.string(),
  operator: z.string().optional(),
  /** Stops in order, [lat, lng]. Used for the computation and, without `shape`, to draw the line. */
  path: z.array(latLngTupleSchema),
  /** Street geometry (when the source has it), for drawing only. */
  shape: z.array(z.array(latLngTupleSchema)).optional(),
  /** Estimated leg (intercity without a mapped line): only links the city to the terminal; drawn dotted. */
  estimated: z.boolean().optional(),
  kind: routeKindSchema.optional(),
});
export type TransitRoute = z.infer<typeof transitRouteSchema>;

export const busStopSchema = z.object({ lat: z.number(), lng: z.number(), name: z.string().optional() });
export type BusStop = z.infer<typeof busStopSchema>;

/** A bus/subway line (one direction) with its exact geometry and stops. */
export const busLineSchema = z.object({
  /** OSM relation ("123456") or "<operator>:<line>:<direction>" (e.g. "emdec:353:1"). */
  id: z.string(),
  ref: z.string().optional(),
  name: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  mode: transitModeSchema,
  color: z.string(),
  operator: z.string().optional(),
  website: z.string().optional(),
  /** [lat, lng] */
  segments: z.array(z.array(latLngTupleSchema)),
  stops: z.array(busStopSchema),
  /** Where it came from: "osm" or the operator id (e.g. "emdec"). */
  source: z.string().optional(),
  /** Line direction on the operator's website (1 or 2). */
  direction: z.number().optional(),
  /** Distance from work to the closest stop ("lines near work" search). */
  nearWorkM: z.number().optional(),
});
export type BusLine = z.infer<typeof busLineSchema>;

/** Departure timetable of a line (per direction and day type). */
export const lineTimetableSchema = z.object({
  ref: z.string(),
  name: z.string().optional(),
  operator: z.string().optional(),
  directions: z.array(
    z.object({
      direction: z.number(),
      /** Starting point and headsign (destination). */
      from: z.string().optional(),
      to: z.string().optional(),
      /** Day label as published by the operator ("Dias úteis"…) → ["04:51", "05:12", …] (with marks like "R"). */
      days: z.array(z.object({ label: z.string(), times: z.array(z.string()) })),
    }),
  ),
  /** Operator note about the line. */
  note: z.string().optional(),
  /** When the operator last updated the timetable, as published. */
  updated: z.string().optional(),
  /** Official page of the line. */
  source: z.string().optional(),
});
export type LineTimetable = z.infer<typeof lineTimetableSchema>;

/** Timetable id: "<operator>:<line>" or "<operator>:<line>:<direction>". */
export const timetableIdSchema = z.string().regex(/^[a-z]+:[\w.-]+(:\d+)?$/i, t.api.invalidLineId);

/** Company or agency that publishes a city's bus lines. */
export const transitOperatorInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  site: z.string(),
  /** What HomeMatch reads from it. */
  provides: z.string(),
});
export type TransitOperatorInfo = z.infer<typeof transitOperatorInfoSchema>;
