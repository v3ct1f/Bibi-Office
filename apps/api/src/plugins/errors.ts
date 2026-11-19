import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError } from "@office/core";

const PG: Record<string, [number, string, string]> = {
  "23505": [409, "conflict", "Resource already exists"],
  "23503": [400, "invalid_reference", "Referenced resource does not exist"],
  "23514": [400, "constraint_violation", "Value violates a constraint"],
  "22P02": [400, "bad_request", "Malformed value"],
  "42501": [403, "forbidden", "Not allowed"],
};

/** RFC 9457 problem+json; never leaks internals on 5xx. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    let status = 500, code = "internal", title = "Internal error", details: unknown;
    const anyErr = err as unknown as { code?: string; statusCode?: number; cause?: { code?: string } };
    const pg = PG[anyErr.code ?? ""] ?? PG[anyErr.cause?.code ?? ""];
    if (err instanceof AppError) {
      ({ status, code } = err); title = err.message; details = err.details;
    } else if (hasZodFastifySchemaValidationErrors(err)) {
      status = 400; code = "validation_failed"; title = "Validation failed";
      details = err.validation.map((v) => ({ path: v.instancePath, message: v.message }));
    } else if (pg) {
      [status, code, title] = pg;
    } else if (anyErr.statusCode && anyErr.statusCode < 500) {
      status = anyErr.statusCode; code = "request_error"; title = err.message;
    }
    if (status >= 500) req.log.error({ err }, "unhandled error");
    reply.status(status).type("application/problem+json").send({
      type: `https://office.dev/problems/${code}`, title, status, code, requestId: req.id, ...(details ? { details } : {}),
    });
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).type("application/problem+json")
      .send({ type: "https://office.dev/problems/not_found", title: "Route not found", status: 404, code: "not_found", requestId: req.id });
  });
}
