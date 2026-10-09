import { createdAt, groups, id, updatedAt, users } from '@isbp/db/schema';
import type { RunProblem } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AfterMode,
  Backoff,
  ConcurrencyPolicy,
  LogLevel,
  RunStatus,
  RunTrigger,
  SkipReason,
  TriggerKind,
} from '../model';

/**
 * All tables of this module live in the `scheduler` Postgres schema. Postgres is the source of truth for
 * schedules (`next_run_at`) and runs; BullMQ only executes them.
 */
export const schedulerSchema = pgSchema('scheduler');

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const jobs = schedulerSchema.table(
  'jobs',
  {
    id: id(),
    /** `JOB-00042`. */
    number: serial('number').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    ownerGroupId: uuid('owner_group_id').references(() => groups.id, { onDelete: 'set null' }),
    /** `<module>.<type>` from the task-type registry. */
    type: varchar('type', { length: 100 }).notNull(),
    /** The type's configuration; secrets of built-in types are `{ sealed }`. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    triggerKind: varchar('trigger_kind', { length: 16 }).$type<TriggerKind>().notNull(),
    cron: varchar('cron', { length: 120 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    intervalMinutes: integer('interval_minutes'),
    afterMode: varchar('after_mode', { length: 8 }).$type<AfterMode>(),
    enabled: boolean('enabled').notNull().default(true),
    /** `auto` after a failure streak; null when a person switched it off (or it is on). */
    disabledReason: varchar('disabled_reason', { length: 16 }),
    timeoutSeconds: integer('timeout_seconds').notNull().default(3_600),
    maxAttempts: smallint('max_attempts').notNull().default(1),
    backoff: varchar('backoff', { length: 16 }).$type<Backoff>().notNull().default('exponential'),
    retryDelaySeconds: integer('retry_delay_seconds').notNull().default(60),
    concurrency: varchar('concurrency', { length: 8 }).$type<ConcurrencyPolicy>().notNull().default('skip'),
    notifyOnFailure: boolean('notify_on_failure').notNull().default(true),
    notifyChannels: boolean('notify_channels').notNull().default(false),
    autoDisableAfter: smallint('auto_disable_after').notNull().default(0),
    /** When the tick fires the next scheduled run (cron/interval jobs that are enabled). */
    nextRunAt: ts('next_run_at'),
    /** When a run of this job was last created (any trigger): the `after` evaluation counts from it. */
    lastQueuedAt: ts('last_queued_at'),
    /** End of the last successful run (`:last_success_at`, incremental loads, `after` jobs). */
    lastSuccessAt: ts('last_success_at'),
    /** Consecutive failed runs (reset by a success). */
    failureStreak: integer('failure_streak').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('jobs_name_uq').on(sql`lower(${t.name})`),
    uniqueIndex('jobs_number_uq').on(t.number),
    index('jobs_due_idx')
      .on(t.nextRunAt)
      .where(sql`${t.enabled} and ${t.nextRunAt} is not null`),
    index('jobs_type_idx').on(t.type),
    index('jobs_owner_idx').on(t.ownerId),
    index('jobs_owner_group_idx').on(t.ownerGroupId),
    check('jobs_trigger_ck', sql`${t.triggerKind} in ('cron', 'interval', 'after', 'manual')`),
  ],
);

/** `job` runs after `upstream` succeeds (trigger kind `after`). */
export const jobUpstreams = schedulerSchema.table(
  'job_upstreams',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    upstreamId: uuid('upstream_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.upstreamId] }),
    index('job_upstreams_upstream_idx').on(t.upstreamId),
  ],
);

export interface AttemptRecord {
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  error: string | null;
  /** Why the attempt failed, for the plain explanation (absent on attempts recorded before it was kept). */
  problem?: RunProblem | null;
}

export const runs = schedulerSchema.table(
  'runs',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** The slot (schedule) or the request time; unique per job so replicas and retried ticks can't double-fire. */
    scheduledFor: ts('scheduled_for').notNull(),
    trigger: varchar('trigger', { length: 16 }).$type<RunTrigger>().notNull(),
    status: varchar('status', { length: 16 }).$type<RunStatus>().notNull().default('queued'),
    skipReason: varchar('skip_reason', { length: 16 }).$type<SkipReason>(),
    /** Current (or next) attempt, 1-based. */
    attempt: smallint('attempt').notNull().default(1),
    maxAttempts: smallint('max_attempts').notNull().default(1),
    /** Attempt history for the timeline. */
    attempts: jsonb('attempts').$type<AttemptRecord[]>().notNull().default([]),
    /** When the executor should next pick it up (enqueue time + delay); a stale value means it was lost. */
    wakeAt: ts('wake_at'),
    nextAttemptAt: ts('next_attempt_at'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    heartbeatAt: ts('heartbeat_at'),
    durationMs: integer('duration_ms'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    upstreamRunId: uuid('upstream_run_id'),
    /** An i18n key (with `summary_params`) or plain text. */
    summary: text('summary'),
    summaryParams: jsonb('summary_params').$type<Record<string, string | number>>(),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull().default({}),
    href: varchar('href', { length: 500 }),
    error: text('error'),
    /** Why it failed, as a kind the UI explains (`runProblemOf`); `error` keeps the raw text. */
    problem: jsonb('problem').$type<RunProblem>(),
    logCount: integer('log_count').notNull().default(0),
    logTruncated: boolean('log_truncated').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('runs_job_slot_uq').on(t.jobId, t.scheduledFor),
    index('runs_job_created_idx').on(t.jobId, t.createdAt),
    index('runs_created_idx').on(t.createdAt),
    index('runs_active_idx')
      .on(t.status)
      .where(sql`${t.status} in ('queued', 'running', 'retrying')`),
  ],
);

export const runLogs = schedulerSchema.table(
  'run_logs',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    at: ts('at').notNull().defaultNow(),
    level: varchar('level', { length: 8 }).$type<LogLevel>().notNull().default('info'),
    attempt: smallint('attempt').notNull().default(1),
    message: text('message').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);
