import type { JobQueue } from '@isbp/sdk/server';
import { Queue } from 'bullmq';
import type { Config } from '../config';

export const EVENTS_QUEUE = 'isbp-events';
export const moduleQueueName = (moduleId: string) => `isbp-m-${moduleId}`;

export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 7 * 86_400, count: 5_000 },
  removeOnFail: { age: 30 * 86_400 },
};

/** Lazily created BullMQ producers (one queue per module, plus the event fan-out queue). */
export class QueueFactory {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly config: Config) {}

  get connection() {
    return { url: this.config.REDIS_URL, maxRetriesPerRequest: null };
  }

  get(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions });
      this.queues.set(name, q);
    }
    return q;
  }

  /** `definitionOf` supplies the job's declared retry policy (`attempts`, `backoffMs`). */
  forModule(
    moduleId: string,
    definitionOf: (name: string) => { attempts?: number; backoffMs?: number } | undefined = () => undefined,
  ): JobQueue {
    return {
      enqueue: async (name, data, opts = {}) => {
        const def = definitionOf(name);
        const job = await this.get(moduleQueueName(moduleId)).add(name, data, {
          delay: opts.delayMs,
          jobId: opts.jobId,
          ...(def?.attempts !== undefined ? { attempts: def.attempts } : {}),
          ...(def?.backoffMs !== undefined
            ? { backoff: { type: 'exponential' as const, delay: def.backoffMs } }
            : {}),
        });
        return job.id ?? '';
      },
    };
  }

  async close() {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
