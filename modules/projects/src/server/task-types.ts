/**
 * Task type `projects.status-report` (Scheduled Jobs, Phase 11): tells people the status report of a period is ready
 * ("every Monday at 09:00, last week's report to the management group"). Each recipient opens the report as they may
 * see it; the narratives they will open are written ahead.
 */
import { departments, groupMembers, groups, users } from '@isbp/db/schema';
import { localize } from '@isbp/sdk';
import type { ModuleContext, TaskTypeHandler } from '@isbp/sdk/server';
import { and, eq, inArray } from 'drizzle-orm';
import { type StatusReportTaskConfig, statusReportTaskConfigSchema } from '../contracts';
import { PERMISSIONS } from '../model';
import { services } from './services';
import { invalid } from './shared';
import { textLocale, texts } from './text';

/** Recipients a run tells at most (and whose narratives it writes ahead). */
const MAX_RECIPIENTS = 500;
const MAX_PREWARM = 50;

type Config = ReturnType<typeof statusReportTaskConfigSchema.parse>;

export function reportHref(
  config: Pick<Config, 'template' | 'scope' | 'departmentId'>,
  periodKey: string,
): string {
  const q = new URLSearchParams({ period: periodKey, template: config.template });
  if (config.scope === 'department' && config.departmentId) {
    q.set('scope', 'department');
    q.set('department', config.departmentId);
  }
  return `/projects/status-report?${q.toString()}`;
}

async function recipients(ctx: ModuleContext, c: Config): Promise<string[]> {
  const [fromGroups, direct] = await Promise.all([
    c.groupKeys.length
      ? ctx.db
          .selectDistinct({ id: users.id })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .innerJoin(users, eq(users.id, groupMembers.userId))
          .where(and(inArray(groups.key, c.groupKeys), eq(users.status, 'active')))
      : Promise.resolve([]),
    c.userIds.length
      ? ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, c.userIds), eq(users.status, 'active')))
      : Promise.resolve([]),
  ]);
  return [...new Set([...fromGroups, ...direct].map((r) => r.id))].slice(0, MAX_RECIPIENTS);
}

export const statusReportTask: TaskTypeHandler<StatusReportTaskConfig> = {
  async validate(raw, ctx) {
    // Scheduled Jobs already requires the type's permission (`projects.reporting.manage`) of the job's editor.
    const c = statusReportTaskConfigSchema.parse(raw);
    const s = services(ctx);
    if (!(await s.templates.find(c.template, { liveOnly: true })))
      throw invalid('template', `There is no report template ${c.template}`);
    if (c.scope === 'department') {
      const [d] = await ctx.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, c.departmentId!));
      if (!d) throw invalid('departmentId', 'There is no such department');
    }
    if (c.groupKeys.length) {
      const found = await ctx.db
        .select({ key: groups.key })
        .from(groups)
        .where(inArray(groups.key, c.groupKeys));
      const missing = c.groupKeys.filter((k) => !found.some((f) => f.key === k));
      if (missing.length)
        throw invalid('groupKeys', `Unknown group: ${missing.join(', ')}`, { code: 'unknown_group' });
    }
  },

  async describe(raw, ctx, opts) {
    const c = statusReportTaskConfigSchema.parse(raw);
    const locale = textLocale(opts?.locale);
    const t = texts(locale);
    const template = await services(ctx).templates.find(c.template);
    return {
      label: t('server.task.label', {
        template: template ? localize(template.name, locale) : c.template,
        period: t(`server.task.period.${c.period}`),
      }),
      href: `/projects/status-report?template=${encodeURIComponent(c.template)}`,
    };
  },

  async run(raw, task, ctx) {
    const c = statusReportTaskConfigSchema.parse(raw);
    const s = services(ctx);
    const schedule = await s.reporting.schedule();
    const slot = s.reporting.periodAt(schedule, task.scheduledFor);
    const period = c.period === 'previous' ? s.reporting.shift(schedule, slot, -1) : slot;
    const template = await s.templates.find(c.template, { liveOnly: true });
    if (!template) throw invalid('template', `There is no report template ${c.template}`);
    const people = await recipients(ctx, c);
    const href = reportHref(c, period.key);
    task.log(`Period ${period.key} (${period.start} – ${period.end}), ${people.length} recipient(s)`);
    if (people.length)
      await ctx.notifications.notify({
        type: 'projects.status-report.ready',
        recipients: people,
        params: { template: template.name, start: period.start, end: period.end },
        href,
      });

    // Write the narratives the first recipients will open (readers who see the same projects share one).
    let prewarmed = 0;
    for (const userId of people.slice(0, MAX_PREWARM)) {
      if (task.signal.aborted) break;
      const auth = await ctx.rbac.authFor(userId);
      if (!auth?.can(PERMISSIONS.use)) continue;
      try {
        await s.reports.build(
          {
            period: period.key,
            template: template.key,
            scope: c.scope,
            ...(c.scope === 'department' && c.departmentId ? { department: c.departmentId } : {}),
          },
          auth,
        );
        prewarmed++;
      } catch (err) {
        task.log(
          `Could not prepare the report for one recipient: ${err instanceof Error ? err.message : err}`,
          'warn',
        );
      }
    }
    return {
      summary: 'projects.taskTypes.statusReport.result',
      summaryParams: { count: people.length },
      metrics: { recipients: people.length, prepared: prewarmed },
      href,
    };
  },
};

export const taskTypes = { 'status-report': statusReportTask };
