import { ErrorCodes, HttpError } from '@isbp/sdk/server';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

function pgError(err: unknown): PgError | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const candidate = e as PgError & { cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate;
    e = candidate.cause;
  }
  return null;
}

/** One JSON error shape everywhere: `{ error: { code, message, details?, requestId } }`. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | HttpError | Error, req, reply) => {
    const requestId = req.id;
    const send = (status: number, code: string, message: string, details?: unknown) =>
      reply.status(status).send({ error: { code, message, details, requestId } });

    if (err instanceof HttpError) return send(err.statusCode, err.code, err.message, err.details);

    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: v.message,
      }));
      return send(400, ErrorCodes.VALIDATION_FAILED, 'Request validation failed', { issues });
    }

    if (isResponseSerializationError(err)) {
      req.log.error({ err, issues: err.cause.issues }, 'response failed schema serialization');
      return send(500, ErrorCodes.INTERNAL, 'Internal server error');
    }

    const pg = pgError(err);
    if (pg?.code === '23505')
      return send(409, ErrorCodes.CONFLICT, 'A record with the same unique value already exists', {
        constraint: pg.constraint,
      });
    if (pg?.code === '23503')
      return send(409, ErrorCodes.CONFLICT, 'The record is referenced by or references a missing record', {
        constraint: pg.constraint,
      });
    if (pg?.code === '23514')
      return send(400, ErrorCodes.BAD_REQUEST, 'The request violates a data rule', {
        constraint: pg.constraint,
      });
    if (pg?.code === '22P02') return send(400, ErrorCodes.BAD_REQUEST, 'Malformed identifier');

    const status = (err as FastifyError).statusCode;
    if (status === 429) return send(429, ErrorCodes.RATE_LIMITED, err.message || 'Too many requests');
    if (status && status >= 400 && status < 500) return send(status, ErrorCodes.BAD_REQUEST, err.message);

    req.log.error({ err }, 'unhandled error');
    return send(500, ErrorCodes.INTERNAL, 'Internal server error');
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: {
        code: ErrorCodes.NOT_FOUND,
        message: `Route ${req.method} ${req.url} not found`,
        requestId: req.id,
      },
    });
  });
}
