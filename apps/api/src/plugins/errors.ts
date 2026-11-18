import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiError } from "@homematch/contracts";
import { t } from "@homematch/i18n";

/** Error with its own HTTP status (e.g. 404 "line not found"). Anything else becomes 502: an external source failed. */
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
      const body: ApiError = { error: t.api.invalidParams, issues: err.issues };
      return reply.status(400).send(body);
    }
    if (err instanceof HttpProblem) return reply.status(err.status).send({ error: err.message } satisfies ApiError);
    const message = err instanceof Error ? err.message : String(err);
    // Fastify's own errors (malformed JSON, body too large) already carry the right status.
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply.status(status).send({ error: message } satisfies ApiError);
    req.log.error(err);
    return reply.status(502).send({ error: message } satisfies ApiError);
  });
}
