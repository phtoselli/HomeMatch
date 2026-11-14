import type { FastifyReply } from "fastify";
import type { StreamEvent } from "@homematch/contracts";

/**
 * Resposta em NDJSON: uma linha JSON por evento (progresso, avisos, parciais) e, no fim, o resultado
 * ou o erro. O cliente lê enquanto chega, então a tela mostra o andamento de buscas que levam minutos.
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
