import type { DomainEvent, Principal } from '@isbp/sdk/server';
import type pg from 'pg';
import type { Kernel } from './kernel';
import { eventsCounter } from './metrics';
import { EVENTS_QUEUE } from './queues';

interface OutboxRow {
  seq: string;
  event_id: string;
  name: string;
  module_id: string;
  payload: unknown;
  actor: Principal | null;
  occurred_at: Date;
}

export interface EventJobData {
  subscriber: string;
  event: DomainEvent;
}

const BATCH = 200;
const POLL_MS = 5_000;

/**
 * Moves committed outbox rows into BullMQ, one job per (event, subscriber) with a deterministic job id,
 * so re-relaying after a crash never double-delivers. Wakes on Postgres NOTIFY, polls as a fallback,
 * and uses `FOR UPDATE SKIP LOCKED` so several workers can relay concurrently.
 */
export class OutboxRelay {
  private listener?: pg.PoolClient;
  private timer?: NodeJS.Timeout;
  private draining = false;
  private again = false;
  private stopped = false;

  constructor(private readonly kernel: Kernel) {}

  async start() {
    this.listener = await this.kernel.pool.connect();
    this.listener.on('notification', () => this.kick());
    this.listener.on('error', (err) => this.kernel.logger.error({ err }, 'outbox listener error'));
    await this.listener.query('listen isbp_outbox');
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.kick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.listener) {
      await this.listener.query('unlisten isbp_outbox').catch(() => undefined);
      this.listener.release();
    }
  }

  private kick() {
    if (this.stopped) return;
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = true;
    void this.drain()
      .catch((err) => this.kernel.logger.error({ err }, 'outbox relay failed'))
      .finally(() => {
        this.draining = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  private async drain() {
    const queue = this.kernel.queues.get(EVENTS_QUEUE);
    for (;;) {
      const client = await this.kernel.pool.connect();
      let relayed = 0;
      try {
        await client.query('begin');
        const { rows } = await client.query<OutboxRow>(
          `select seq, event_id, name, module_id, payload, actor, occurred_at
             from core.outbox_events
            where dispatched_at is null
            order by seq
            limit ${BATCH}
              for update skip locked`,
        );
        if (rows.length) {
          const jobs = rows.flatMap((row) => {
            const event: DomainEvent = {
              id: row.event_id,
              name: row.name,
              moduleId: row.module_id,
              payload: row.payload,
              actor: row.actor,
              occurredAt: new Date(row.occurred_at).toISOString(),
            };
            return this.kernel.registry.subscribersOf(row.name).map((m) => ({
              name: row.name,
              data: { subscriber: m.manifest.id, event } satisfies EventJobData,
              opts: { jobId: `${row.event_id}__${m.manifest.id}`, attempts: 8 },
            }));
          });
          if (jobs.length) await queue.addBulk(jobs);
          await client.query(
            'update core.outbox_events set dispatched_at = now(), attempts = attempts + 1 where seq = any($1::bigint[])',
            [rows.map((r) => r.seq)],
          );
          for (const r of rows) eventsCounter.inc({ stage: 'relayed', name: r.name, status: 'ok' });
        }
        await client.query('commit');
        relayed = rows.length;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      if (relayed < BATCH) return;
    }
  }
}
