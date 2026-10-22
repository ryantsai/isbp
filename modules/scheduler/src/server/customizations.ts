import { groups, users } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  HttpError,
  likePattern,
  type LocalizedText,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import { createJobSchema, DEFAULT_ALERTS, DEFAULT_RETRIES, type Trigger } from '../contracts';
import { BUILTIN_TYPES, jobHref, LIMITS, redactConfig } from '../model';
import { cronError, isValidTimezone } from '../schedule';
import type { JobRow } from './engine';
import { jobs, jobUpstreams } from './schema';
import { services } from './services';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const f = createJobSchema.shape;

/** The job form without `enabled`: a disabled job is an archived one. */
export const jobValueSchema = z.object({
  name: f.name.describe('Unique job name (case-insensitive)'),
  description: f.description.describe('What the job does and why, for the people who look after it'),
  ownerId: f.ownerId.describe(
    'User id of the owner (null for none). Omitted: the person applying (create) or unchanged (update)',
  ),
  ownerGroupId: f.ownerGroupId.describe('Group id whose members may also edit and run the job, or null'),
  type: f.type.describe(
    'Task type, e.g. scheduler.http or etl.pipeline (see the guide). Fixed after creation',
  ),
  config: f.config.describe(
    'The task type’s configuration, in the shape of its configSchema in the guide. Secrets read back as { "secret": true, "set": true }; sending that back keeps the stored value',
  ),
  trigger: f.trigger.describe(
    'When it runs: { kind: "cron", cron, timezone } · { kind: "interval", intervalMinutes } · { kind: "after", upstreamIds, mode } · { kind: "manual" }',
  ),
  timeoutSeconds: f.timeoutSeconds.describe('An attempt running longer than this is stopped'),
  retries: f.retries.describe('Attempts per run (1 = no retry), backoff fixed or exponential, first delay'),
  concurrency: f.concurrency.describe('skip: a due run is skipped while one runs; queue: it waits'),
  alerts: f.alerts.describe(
    'onFailure notifies the owner and group, channels posts to Teams/Slack, autoDisableAfter disables after N failures in a row (0 = never)',
  ),
});
export type JobValue = z.infer<typeof jobValueSchema>;

function triggerOf(job: JobRow, upstreamIds: string[]): Trigger {
  switch (job.triggerKind) {
    case 'cron':
      return { kind: 'cron', cron: job.cron ?? '', timezone: job.timezone };
    case 'interval':
      return { kind: 'interval', intervalMinutes: job.intervalMinutes ?? LIMITS.intervalMinutes.min };
    case 'after':
      return { kind: 'after', upstreamIds, mode: job.afterMode ?? 'all' };
    default:
      return { kind: 'manual' };
  }
}

/** The stored job as a value (secrets redacted, upstream jobs in a stable order). */
async function valueOf(ctx: ModuleContext, job: JobRow): Promise<JobValue> {
  const upstreamIds =
    job.triggerKind === 'after'
      ? (
          await ctx.db
            .select({ id: jobUpstreams.upstreamId })
            .from(jobUpstreams)
            .where(eq(jobUpstreams.jobId, job.id))
            .orderBy(asc(jobUpstreams.upstreamId))
        ).map((r) => r.id)
      : [];
  return {
    name: job.name,
    description: job.description,
    ownerId: job.ownerId,
    ownerGroupId: job.ownerGroupId,
    type: job.type,
    config: redactConfig(job.type, job.config),
    trigger: triggerOf(job, upstreamIds),
    timeoutSeconds: job.timeoutSeconds,
    retries: { maxAttempts: job.maxAttempts, backoff: job.backoff, delaySeconds: job.retryDelaySeconds },
    concurrency: job.concurrency,
    alerts: {
      onFailure: job.notifyOnFailure,
      channels: job.notifyChannels,
      autoDisableAfter: job.autoDisableAfter,
    },
  };
}

async function rowOf(ctx: ModuleContext, id: string): Promise<JobRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

/**
 * A service's refusal as issues. A 403 is left to the apply: the proposer may lack the task type's
 * permission that a reviewer holds.
 */
function refusal(err: unknown): CustomizationIssue[] {
  if (!(err instanceof HttpError)) throw err;
  if (err.statusCode === 403) return [];
  const issues = (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues;
  if (issues?.length) return issues.map((i) => ({ path: i.path, message: i.message, code: 'invalid' }));
  return [{ path: '', message: err.message, code: err.code.toLowerCase() }];
}

async function checkTrigger(ctx: ModuleContext, t: Trigger, jobId: string | null) {
  const issues: CustomizationIssue[] = [];
  if (t.kind === 'cron') {
    if (!isValidTimezone(t.timezone))
      issues.push({ path: 'trigger.timezone', message: 'Unknown time zone', code: 'unknown_timezone' });
    else {
      const err = cronError(t.cron, t.timezone);
      if (err) issues.push({ path: 'trigger.cron', message: err, code: 'invalid_cron' });
    }
  }
  if (t.kind === 'after') {
    const ids = [...new Set(t.upstreamIds)];
    if (jobId && ids.includes(jobId))
      issues.push({ path: 'trigger.upstreamIds', message: 'A job cannot run after itself', code: 'self' });
    const found = new Set(
      (await ctx.db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.id, ids))).map((r) => r.id),
    );
    t.upstreamIds.forEach((id, i) => {
      if (!found.has(id))
        issues.push({ path: `trigger.upstreamIds.${i}`, message: 'No such job', code: 'unknown_job' });
    });
  }
  return issues;
}

type HttpCheckText = typeof en.customizations.templates.httpCheck;
/** A question of the HTTP check template in every language. */
const label = (key: keyof HttpCheckText): LocalizedText => ({
  en: en.customizations.templates.httpCheck[key],
  'zh-TW': zh.customizations.templates.httpCheck[key],
  'ja-JP': ja.customizations.templates.httpCheck[key],
});

/** `scheduler.job`: a scheduled job, live on apply; archiving disables it. */
export const jobCustomization: CustomizationHandler<JobValue> = {
  schema: jobValueSchema,

  async guide(ctx) {
    const [connections, teams] = await Promise.all([
      ctx.databases.list({ purpose: 'data', enabledOnly: true }),
      ctx.db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(ne(groups.key, 'everyone'))
        .orderBy(asc(groups.name))
        .limit(200),
    ]);
    const sandbox = ctx.sandbox.status();
    return {
      instructions: [
        'A scheduled job runs one task type on a trigger. Pick `type` from `taskTypes` and build `config` from its `configSchema` (scheduler.http calls a URL; scheduler.sql runs one statement with :name parameters on a data connection and needs scheduler.sql.run; scheduler.script runs code in a sandbox image and needs scheduler.scripts.manage; core.assign-form asks a person or group to fill in a form by a date, once per period — monthly inspections, quarterly or yearly reviews — and needs core.forms.manage; other modules add types such as etl.pipeline). Saving a job also needs the task type’s `permission`.',
        'core.assign-form: the run opens the assignment of the period (day, week, month, quarter, year) its slot falls in, in the trigger’s time zone, so schedule it at the start of each period (e.g. "0 9 1 * *" monthly, "0 9 1 1,4,7,10 *" quarterly, "0 9 2 1 *" yearly). `due` is the end of that period or `days` after the run; `title` may use {{period}} (e.g. 2026-10, 2026-Q4). Runs are idempotent per form, assignee and period.',
        'Triggers: cron is five fields evaluated in an IANA `timezone` (e.g. "0 2 * * *", "Asia/Taipei"); interval repeats every `intervalMinutes`; after runs when the `upstreamIds` jobs succeed (`mode` all or any; no loops); manual runs only on demand.',
        `Defaults: timeoutSeconds ${LIMITS.timeoutSeconds.default}, retries ${JSON.stringify(DEFAULT_RETRIES)}, concurrency "skip", alerts ${JSON.stringify(DEFAULT_ALERTS)}.`,
        'Never put secrets in a description. For HTTP auth or secret headers, put the value in the config’s secret slot; existing secrets read back as { "secret": true, "set": true } and keep their value when sent back unchanged.',
        'Applying makes the job live (enabled). Archive disables it; restore enables it again.',
      ].join('\n'),
      reference: {
        taskTypes: ctx.taskTypes.list().map((t) => ({
          type: t.type,
          module: t.moduleId,
          permission: t.permission,
          configSchema: t.configSchema,
        })),
        triggerKinds: ['cron', 'interval', 'after', 'manual'],
        limits: {
          timeoutSeconds: LIMITS.timeoutSeconds,
          attempts: LIMITS.attempts,
          retryDelaySeconds: LIMITS.retryDelaySeconds,
          intervalMinutes: LIMITS.intervalMinutes,
          autoDisableAfter: LIMITS.autoDisable,
          upstreams: LIMITS.upstreams,
        },
        dataConnections: connections.map((c) => ({
          id: c.id,
          name: c.name,
          engine: c.engine,
          readOnly: c.readOnly,
        })),
        scriptImages: sandbox.runner === 'none' ? [] : sandbox.images,
        groups: teams,
      },
      examples: [
        {
          description: 'Check the intranet home page every 10 minutes and disable after 5 failures in a row',
          value: {
            name: 'Intranet health check',
            description: 'Alerts the web team when the intranet home page stops answering',
            ownerGroupId: null,
            type: BUILTIN_TYPES.http,
            config: { method: 'GET', url: 'https://intranet.example.com/', expectedStatus: '200-299' },
            trigger: { kind: 'interval', intervalMinutes: 10 },
            timeoutSeconds: 60,
            retries: { maxAttempts: 2, backoff: 'fixed', delaySeconds: 30 },
            concurrency: 'skip',
            alerts: { onFailure: true, channels: false, autoDisableAfter: 5 },
          },
        },
        {
          description:
            'Open the monthly server room inspection for the IS operations group on the 1st at 09:00 Taipei time, due at the end of the month (core.assign-form; the form key and group key must exist)',
          value: {
            name: 'Monthly server room inspection',
            description: 'Asks IS operations to fill in the server room inspection checklist every month',
            ownerGroupId: null,
            type: 'core.assign-form',
            config: {
              formKey: 'server-room-inspection',
              assignee: { type: 'group', groupKey: 'it-ops' },
              period: 'month',
              due: { type: 'end-of-period' },
              title: 'Server room inspection {{period}}',
            },
            trigger: { kind: 'cron', cron: '0 9 1 * *', timezone: 'Asia/Taipei' },
            timeoutSeconds: 60,
            retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 60 },
            concurrency: 'skip',
            alerts: { onFailure: true, channels: false, autoDisableAfter: 0 },
          },
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const p = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select({ id: jobs.id, name: jobs.name, description: jobs.description, enabled: jobs.enabled })
      .from(jobs)
      .where(
        and(
          includeArchived ? undefined : eq(jobs.enabled, true),
          p ? or(ilike(jobs.name, p), ilike(jobs.description, p)) : undefined,
        ),
      )
      .orderBy(sql`lower(${jobs.name})`, asc(jobs.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      label: r.name,
      description: r.description,
      archived: !r.enabled,
      href: jobHref(r.id),
    }));
  },

  async get(id, ctx) {
    const job = await rowOf(ctx, id);
    if (!job) return null;
    return {
      id: job.id,
      label: job.name,
      description: job.description,
      archived: !job.enabled,
      href: jobHref(job.id),
      value: await valueOf(ctx, job),
    };
  },

  async check({ op, id, value }, ctx, auth) {
    const issues: CustomizationIssue[] = [];
    const current = id ? await rowOf(ctx, id) : null;
    if (op === 'delete' && current) {
      const dependents = await ctx.db
        .select({ name: jobs.name })
        .from(jobUpstreams)
        .innerJoin(jobs, eq(jobs.id, jobUpstreams.jobId))
        .where(eq(jobUpstreams.upstreamId, current.id));
      if (dependents.length)
        issues.push({
          path: '',
          message: `Other jobs run after this one: ${dependents.map((d) => d.name).join(', ')}`,
          code: 'in_use',
        });
    }
    if ((op !== 'create' && op !== 'update') || !value) return issues;

    if (current && value.type !== current.type)
      issues.push({ path: 'type', message: 'The task type of a job cannot change', code: 'immutable' });
    else if (!ctx.taskTypes.list().some((t) => t.type === value.type))
      issues.push({ path: 'type', message: `Unknown task type ${value.type}`, code: 'unknown_type' });

    const [dupe] = await ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(sql`lower(${jobs.name}) = lower(${value.name})`, current ? ne(jobs.id, current.id) : undefined),
      );
    if (dupe) issues.push({ path: 'name', message: 'Another job has this name', code: 'duplicate_name' });

    if (value.ownerId) {
      const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, value.ownerId));
      if (!u) issues.push({ path: 'ownerId', message: 'Unknown person', code: 'unknown_user' });
    }
    if (value.ownerGroupId) {
      const [g] = await ctx.db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, value.ownerGroupId));
      if (!g) issues.push({ path: 'ownerGroupId', message: 'Unknown group', code: 'unknown_group' });
    }
    issues.push(...(await checkTrigger(ctx, value.trigger, current?.id ?? null)));

    // The task type validates its own config (and the job service resolves secret placeholders).
    if (!issues.some((i) => i.path === 'type'))
      try {
        await services(ctx).jobs.prepareConfig(value.type, value.config, current?.config ?? null, auth);
      } catch (err) {
        issues.push(...refusal(err));
      }
    return issues;
  },

  async apply({ op, id, value }, ctx, auth) {
    const s = services(ctx).jobs;
    switch (op) {
      case 'create':
        return { id: (await s.create({ ...value!, enabled: true }, auth)).id };
      case 'update': {
        const { type: _type, ...rest } = value!;
        void _type;
        await s.update(id!, rest, auth);
        return { id: id! };
      }
      case 'archive':
      case 'restore':
        await s.setEnabled(id!, op === 'restore', auth);
        return { id: id! };
      case 'delete':
        await s.remove(id!, auth);
        return { id: id! };
    }
  },

  templates: [
    {
      id: 'http-check',
      label: 'scheduler.customizations.templates.httpCheck.label',
      description: 'scheduler.customizations.templates.httpCheck.description',
      fields: async () => [
        { key: 'name', type: 'text', label: label('name'), required: true, validation: { maxLength: 200 } },
        { key: 'url', type: 'url', label: label('url'), required: true },
        {
          key: 'everyMinutes',
          type: 'number',
          label: label('every'),
          required: true,
          defaultValue: 15,
          validation: { min: LIMITS.intervalMinutes.min, max: LIMITS.intervalMinutes.max },
        },
      ],
      build: async (answers) => {
        const name = String(answers.name);
        return {
          op: 'create',
          label: name,
          value: {
            name,
            description: null,
            ownerGroupId: null,
            type: BUILTIN_TYPES.http,
            config: {
              method: 'GET',
              url: String(answers.url),
              expectedStatus: '200-299',
              timeoutSeconds: 30,
            },
            trigger: { kind: 'interval', intervalMinutes: Math.round(Number(answers.everyMinutes)) },
            timeoutSeconds: 60,
            retries: { ...DEFAULT_RETRIES },
            concurrency: 'skip',
            alerts: { ...DEFAULT_ALERTS },
          },
        };
      },
    },
  ],
};
