/**
 * Respostas longas (/analyze, /listings, /links) chegam em NDJSON: uma linha JSON por evento.
 * progress/warning informam, partial traz um pedaço do resultado, result fecha e error encerra com falha.
 */
export type StreamEvent<T> =
  | { type: "progress"; message: string }
  | { type: "warning"; message: string }
  | { type: "partial"; data: T }
  | { type: "result"; data: T }
  | { type: "error"; message: string };

/** Só os avisos de andamento (o que os serviços emitem enquanto trabalham). */
export type ProgressEvent = Extract<StreamEvent<never>, { type: "progress" | "warning" }>;
export type Emit = (ev: ProgressEvent) => void;

/** Corpo de erro das respostas JSON da API. */
export interface ApiError {
  error: string;
  issues?: unknown[];
}
