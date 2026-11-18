import type { FastifyReply } from "fastify";
import type { StreamEvent } from "@homematch/contracts";

/**
 * NDJSON response: one JSON line per event (progress, warnings, partial results) and, at the end, the result or the
 * error. The client reads as it arrives, so the screen shows the progress of searches that take minutes.
 */
export async function stream<T>(reply: FastifyReply, run: (emit: (ev: StreamEvent<T>) => void) => Promise<T>) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  const emit = (ev: StreamEvent<T>) => raw.write(JSON.stringify(ev) + "\n");
  try {
    const data = await run(emit);
    emit({ type: "result", data });
  } catch (e) {
    reply.log.error(e);
    emit({ type: "error", message: (e as Error).message });
  } finally {
    raw.end();
  }
}
