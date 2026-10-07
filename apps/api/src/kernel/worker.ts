import type { EventHandler, JobRun, Principal, WorkflowCompletion } from '@isbp/sdk/server';
import { type Job, Worker } from 'bullmq';
import { runWithContext } from './context';
import type { Kernel } from './kernel';
import { eventsCounter, jobsCounter } from './metrics';
import { WORKFLOW_COMPLETED_EVENT } from './modules';
import { type EventJobData, OutboxRelay } from './outbox-relay';
import { EVENTS_QUEUE, moduleQueueName } from './queues';

function withTimeout<T>(promise: Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Background side of the platform: relays the outbox, runs module event handlers and jobs, and keeps
 * recurring schedules (declared in module definitions) in sync with BullMQ.
 */
export async function startWorker(kernel: Kernel) {
  const { registry, queues, logger, config } = kernel;
  const workers: Worker[] = [];
  const connection = queues.connection;

  const relay = new OutboxRelay(kernel);
  await relay.start();

  workers.push(
    new Worker<EventJobData>(
      EVENTS_QUEUE,
      async (job) => {
        const { subscriber, event } = job.data;
        const mod = registry.get(subscriber);
        const trigger =
          event.name === WORKFLOW_COMPLETED_EVENT
            ? (event.payload as WorkflowCompletion).triggerKey
            : undefined;
        const onCompleted = trigger ? mod?.workflows?.[trigger]?.onCompleted : undefined;
        const onSyncChange = mod?.onSyncChange;
        const handler: EventHandler | undefined =
          mod?.events?.[event.name] ??
          (onCompleted ? (evt, ctx) => onCompleted(evt.payload as WorkflowCompletion, ctx) : undefined) ??
          (onSyncChange && kernel.sync.isSyncEvent(event.name)
            ? async (evt, ctx) => {
                for (const change of kernel.sync.changesFor(evt)) await onSyncChange(change, ctx);
              }
            : undefined);
        if (!mod || !handler || !registry.isEnabled(subscriber)) return { skipped: true };
        const principal: Principal = {
          type: 'system',
          id: null,
          name: `module:${subscriber}`,
          ...(event.actor?.id ? { onBehalfOf: { id: event.actor.id, name: event.actor.name } } : {}),
        };
        try {
          await runWithContext({ principal, requestId: event.id }, () =>
            handler(event, registry.context(subscriber)),
          );
          eventsCounter.inc({ stage: 'handled', name: event.name, status: 'ok' });
        } catch (err) {
          eventsCounter.inc({ stage: 'handled', name: event.name, status: 'error' });
          throw err;
        }
        return { handled: true };
      },
      { connection, concurrency: config.WORKER_CONCURRENCY },
    ),
  );

  for (const mod of registry.modules) {
    const jobs = mod.jobs ?? {};
    const names = Object.keys(jobs);
    if (!names.length) continue;
    const id = mod.manifest.id;
    const queueName = moduleQueueName(id);
    const concurrency = Math.max(1, ...names.map((n) => jobs[n]!.concurrency ?? 1));

    workers.push(
      new Worker(
        queueName,
        async (job: Job) => {
          const def = jobs[job.name];
          if (!def) throw new Error(`Unknown job "${job.name}" for module "${id}"`);
          if (!registry.isEnabled(id)) return { skipped: 'module disabled' };
          const run: JobRun = {
            id: job.id ?? '',
            name: job.name,
            data: job.data,
            attempt: job.attemptsMade + 1,
            log: async (message) => void (await job.log(message)),
            updateProgress: async (p) => job.updateProgress(p),
          };
          const principal: Principal = { type: 'system', id: null, name: `job:${id}.${job.name}` };
          try {
            const result = await runWithContext({ principal, requestId: job.id }, () =>
              withTimeout(def.handler(run, registry.context(id)), def.timeoutMs, `${id}.${job.name}`),
            );
            jobsCounter.inc({ queue: queueName, name: job.name, status: 'completed' });
            return result;
          } catch (err) {
            jobsCounter.inc({ queue: queueName, name: job.name, status: 'failed' });
            throw err;
          }
        },
        { connection, concurrency },
      ),
    );

    // Reconcile recurring schedules declared in code (dynamic `idp-sync-*` schedules are managed by core).
    const queue = queues.get(queueName);
    const declared = new Set<string>();
    for (const [name, def] of Object.entries(jobs)) {
      if (!def.schedule) continue;
      declared.add(name);
      const repeat = def.schedule.cron
        ? { pattern: def.schedule.cron, tz: def.schedule.tz }
        : { every: def.schedule.everyMs ?? 60_000 };
      await queue.upsertJobScheduler(name, repeat, {
        name,
        data: {},
        opts: {
          attempts: def.attempts ?? 3,
          backoff: { type: 'exponential', delay: def.backoffMs ?? 5_000 },
        },
      });
    }
    for (const s of await queue.getJobSchedulers()) {
      if (!declared.has(s.key) && !s.key.startsWith('idp-sync-')) await queue.removeJobScheduler(s.key);
    }
  }

  for (const w of workers) {
    w.on('failed', (job, err) =>
      logger.warn(
        { queue: w.name, job: job?.name, id: job?.id, attempts: job?.attemptsMade, err },
        'job failed',
      ),
    );
    w.on('error', (err) => logger.error({ err, queue: w.name }, 'worker error'));
  }

  await queues
    .forModule('core')
    .enqueue('refresh-sync-schedules', {}, { jobId: `refresh-sync-${Date.now()}` });
  logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

  return async function stop() {
    await relay.stop();
    await Promise.allSettled(workers.map((w) => w.close()));
  };
}
