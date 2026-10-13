/**
 * Customisation kinds of status reporting (Phase 11), built on the admin page's schemas and services, so the assistant
 * (and outside agents over MCP) can only propose what Administration → Project status reporting would accept:
 *
 * - `projects.status-schedule` (update only): the organisation's one reporting schedule;
 * - `projects.report-template` (create, update, archive): the status report's templates.
 */
import { groups } from '@isbp/db/schema';
import type { CustomizationHandler, CustomizationIssue } from '@isbp/sdk/server';
import { localize } from '@isbp/sdk/server';
import { asc, ne } from 'drizzle-orm';
import {
  type ReportTemplateInput,
  reportTemplateInputSchema,
  type StatusScheduleInput,
  statusScheduleInputSchema,
} from '../contracts';
import { DEFAULT_REPORT_TEMPLATES, REPORT_SECTION_TYPES, REPORT_STATES } from '../model';
import { ReportingService } from './reporting';
import { ReportTemplateService, templateDto } from './report-templates';

const SCHEDULE_ID = 'default';
const ADMIN_HREF = '/projects/reporting';

export const statusScheduleKind: CustomizationHandler<StatusScheduleInput> = {
  schema: statusScheduleInputSchema,

  async guide(ctx) {
    const svc = new ReportingService(ctx);
    const s = await svc.schedule();
    const groupList = await ctx.db
      .select({ key: groups.key, name: groups.name })
      .from(groups)
      .where(ne(groups.key, 'everyone'))
      .orderBy(asc(groups.name))
      .limit(200);
    return {
      instructions: [
        "There is exactly one schedule, id 'default'; only update it.",
        'Who reports: on every active project, its managers (managers: true) and the members of the group groupKey who are a manager or member of the project. A person on three projects writes three updates per period.',
        'cadence: weekly (ISO weeks), biweekly (pairs of ISO weeks counted from Monday 2024-01-01) or monthly. dueWeekday: 1 = Monday … 5 = Friday; monthly updates are due on the last such weekday of the month. Updates are due by the end of that day in timeZone (IANA) and stay open until the period ends.',
        'remindDaysBefore: reporters are reminded at 09:00 that many days before the due day; the overdue notice and the managers\' "missing" notice follow automatically.',
        "Turning enabled off stops new updates and removes the open period's unsent ones; sent updates are kept.",
      ].join('\n'),
      reference: {
        current: svc.valueOf(s),
        currentPeriod: svc.periodAt(s),
        groups: groupList,
      },
      examples: [
        {
          description: 'Project managers and the "team-leads" group report every Friday',
          value: {
            enabled: true,
            cadence: 'weekly',
            dueWeekday: 5,
            timeZone: 'Asia/Taipei',
            managers: true,
            groupKey: 'team-leads',
            remindDaysBefore: 1,
          },
        },
      ],
    };
  },

  async list() {
    return [
      {
        id: SCHEDULE_ID,
        label: 'Status reporting schedule',
        description: 'Cadence, due day and who reports',
        href: ADMIN_HREF,
      },
    ];
  },

  async get(id, ctx) {
    if (id !== SCHEDULE_ID) return null;
    const svc = new ReportingService(ctx);
    const s = await svc.schedule();
    return {
      id: SCHEDULE_ID,
      label: 'Status reporting schedule',
      description: s.enabled ? `${s.cadence}, due weekday ${s.dueWeekday}` : 'Off',
      href: ADMIN_HREF,
      value: svc.valueOf(s),
    };
  },

  async check({ id, value }, ctx) {
    const issues: CustomizationIssue[] = [];
    if (id !== SCHEDULE_ID)
      issues.push({ path: '', message: "The schedule's id is 'default'", code: 'unknown' });
    if (value?.groupKey) {
      try {
        await new ReportingService(ctx).checkGroup(value.groupKey);
      } catch {
        issues.push({
          path: 'groupKey',
          message: `There is no group with the key ${value.groupKey}`,
          code: 'unknown_group',
        });
      }
    }
    return issues;
  },

  async apply({ value }, ctx, auth) {
    await new ReportingService(ctx).updateSchedule(statusScheduleInputSchema.parse(value), auth);
    return { id: SCHEDULE_ID };
  },

  async committed(_change, ctx) {
    await new ReportingService(ctx).refreshSoon();
  },
};

const templateSummary = (t: ReturnType<typeof templateDto>) => ({
  id: t.id,
  label: `${localize(t.name, 'en')} (${t.key})`,
  description: `${t.sections.length} sections`,
  archived: t.archived,
  href: ADMIN_HREF,
  links: t.archived
    ? []
    : [
        {
          href: `/projects/status-report?template=${t.key}`,
          label: { en: 'Open the report', 'zh-TW': '開啟報告', 'ja-JP': 'レポートを開く' },
        },
      ],
});

export const reportTemplateKind: CustomizationHandler<ReportTemplateInput> = {
  schema: reportTemplateInputSchema,

  async guide(ctx) {
    const list = await new ReportTemplateService(ctx).list({ archived: true });
    return {
      instructions: [
        'A template lays out the status report: an ordered list of sections, top to bottom. key: a unique lowercase slug that cannot change. name and description: text in en, zh-TW and ja-JP.',
        `Section types: ${REPORT_SECTION_TYPES.join(', ')}. Every section has a unique id (lowercase slug) and an optional title in three languages (null = the default heading).`,
        'summary: a narrative of the period written by the AI (or builtin); instructions (optional) steer it, e.g. "focus on customer impact and budget".',
        'counts: how many projects are in each state. projects: projects in the listed states, shown as detail "table" (one row each), "brief" (one line each) or "full" (the merged update: done, next, blockers).',
        `States: ${REPORT_STATES.join(', ')}. A project is delayed when someone reports it off track, its expected finish is after the target date, the target date has passed or milestones are overdue; at risk when reported so or enough tasks are overdue.`,
        "blockers and asks: blockers and help needed, merged across projects. milestones: due in the next `days` (7-90) days and overdue. missing: updates not received. decisions: decisions of the projects' meetings in the period (when the meetings module is on).",
      ].join('\n'),
      reference: {
        templates: list.map((t) => ({
          id: t.id,
          key: t.key,
          name: localize(t.name, 'en'),
          archived: t.archived,
          sections: t.sections.map((s) => s.type),
        })),
      },
      examples: [
        {
          description: 'A one-page board report: summary, counts and the projects that need attention',
          value: {
            key: 'board-monthly',
            name: { en: 'Board report', 'zh-TW': '董事會報告', 'ja-JP': '取締役会向けレポート' },
            description: {
              en: 'For the monthly board meeting',
              'zh-TW': '每月董事會使用',
              'ja-JP': '月次の取締役会向け',
            },
            sections: [
              { id: 'summary', type: 'summary', instructions: 'Lead with risks to revenue and customers.' },
              { id: 'counts', type: 'counts' },
              { id: 'attention', type: 'projects', states: ['delayed', 'at_risk'], detail: 'brief' },
              { id: 'asks', type: 'asks' },
            ],
          },
        },
        {
          description: 'The built-in detailed template',
          value: {
            key: 'detailed-copy',
            name: { en: 'Detailed status (copy)' },
            sections: DEFAULT_REPORT_TEMPLATES[1]!.sections,
          },
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const term = q?.trim().toLowerCase();
    const list = await new ReportTemplateService(ctx).list({ archived: includeArchived });
    return list
      .filter(
        (t) =>
          !term || t.key.includes(term) || Object.values(t.name).some((n) => n?.toLowerCase().includes(term)),
      )
      .slice(0, limit)
      .map(templateSummary);
  },

  async get(id, ctx) {
    const svc = new ReportTemplateService(ctx);
    const row = await svc.find(id);
    if (!row) return null;
    return { ...templateSummary(templateDto(row)), value: svc.valueOf(row) };
  },

  async check({ op, id, value }, ctx) {
    const issues: CustomizationIssue[] = [];
    if (!value) return issues;
    const svc = new ReportTemplateService(ctx);
    if (op === 'create' && (await svc.keyTaken(value.key, null)))
      issues.push({ path: 'key', message: `The key ${value.key} is taken`, code: 'duplicate' });
    if (op === 'update' && id) {
      const current = await svc.find(id);
      if (current && current.key !== value.key)
        issues.push({ path: 'key', message: 'The key of a template cannot change', code: 'immutable' });
    }
    return issues;
  },

  async apply({ op, id, value }, ctx, auth) {
    const svc = new ReportTemplateService(ctx);
    if (op === 'create') return { id: (await svc.create(reportTemplateInputSchema.parse(value), auth)).id };
    if (op === 'update')
      return { id: (await svc.update(id!, reportTemplateInputSchema.parse(value), auth)).id };
    return { id: (await svc.setArchived(id!, op === 'archive', auth)).id };
  },
};

export const customizations = {
  'status-schedule': statusScheduleKind,
  'report-template': reportTemplateKind,
};
