/**
 * Long responses (/analyze, /listings, /links) are streamed as NDJSON: one JSON line per event.
 * progress/warning inform, partial carries a chunk of the result, result closes and error ends with a failure.
 */
export type StreamEvent<T> =
  | { type: "progress"; message: string }
  | { type: "warning"; message: string }
  | { type: "partial"; data: T }
  | { type: "result"; data: T }
  | { type: "error"; message: string };

/** Progress notices only (what services emit while they work). */
export type ProgressEvent = Extract<StreamEvent<never>, { type: "progress" | "warning" }>;
export type Emit = (ev: ProgressEvent) => void;

/** Error body of JSON API responses. */
export interface ApiError {
  error: string;
  issues?: unknown[];
}
