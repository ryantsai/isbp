import { outboxEvents, uuidv7 } from '@isbp/db/schema';
import type { Db, EventPublisher, ModuleManifest } from '@isbp/sdk/server';
import type { FastifyBaseLogger } from 'fastify';
import { currentPrincipal } from './context';

/**
 * Publishes into the transactional outbox. Pass `tx` so the event commits atomically with the change;
 * the worker's relay delivers it to subscribers after commit (at-least-once, idempotent job ids).
 */
export function createEventPublisher(
  db: Db,
  manifest: ModuleManifest,
  log: FastifyBaseLogger,
): EventPublisher {
  const declared = new Set(manifest.events?.emits?.map((e) => e.name) ?? []);
  const schemas = new Map(manifest.events?.emits?.map((e) => [e.name, e.schema]) ?? []);
  return {
    async publish(name, payload, opts = {}) {
      if (!name.startsWith(`${manifest.id}.`)) {
        throw new Error(`Module "${manifest.id}" cannot publish foreign event "${name}"`);
      }
      if (!declared.has(name))
        log.warn({ event: name }, 'publishing an event not declared in manifest.events.emits');
      const schema = schemas.get(name);
      if (schema) {
        const result = schema.safeParse(payload);
        if (!result.success) throw new Error(`Invalid payload for event "${name}": ${result.error.message}`);
      }
      const principal = currentPrincipal();
      await (opts.tx ?? db).insert(outboxEvents).values({
        eventId: uuidv7(),
        name,
        moduleId: manifest.id,
        payload: payload ?? {},
        actor: { type: principal.type, id: principal.id, name: principal.name },
      });
    },
  };
}
