import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiError } from "@homematch/contracts";

/** Erro com status HTTP próprio (ex.: 404 "linha não encontrada"). O resto vira 502: falha de uma fonte externa. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      const body: ApiError = { error: "Parâmetros inválidos", issues: err.issues };
      return reply.status(400).send(body);
    }
    if (err instanceof HttpProblem) return reply.status(err.status).send({ error: err.message } satisfies ApiError);
    const message = err instanceof Error ? err.message : String(err);
    // Erros do próprio Fastify (JSON malformado, corpo grande demais) já trazem o status certo.
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply.status(status).send({ error: message } satisfies ApiError);
    req.log.error(err);
    return reply.status(502).send({ error: message } satisfies ApiError);
  });
}
