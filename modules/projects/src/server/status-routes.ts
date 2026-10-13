/**
 * Status reporting routes (Phase 11, `docs/architecture.md` §17): the schedule, status updates, compliance, the status
 * report with its Markdown export, and report templates. Mounted under /api/v1/projects with the other routes.
 */
import { groups } from '@isbp/db/schema';
import { likePattern, type ModuleContext, type ModuleRouter } from '@isbp/sdk/server';
import { asc, ilike, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  complianceQuerySchema,
  complianceSchema,
  lookupQuerySchema,
  projectStatusUpdatesSchema,
  reportTemplateInputSchema,
  reportTemplateQuerySchema,
  reportTemplateSchema,
  statusDraftSchema,
  statusReportQuerySchema,
  statusReportSchema,
  statusScheduleInputSchema,
  statusScheduleSchema,
  statusUpdateHistoryQuerySchema,
  statusUpdateInputSchema,
  statusUpdatePatchSchema,
  statusUpdateSchema,
} from '../contracts';
import { PERMISSIONS } from '../model';
import { canManageTemplates } from './report-templates';
import { services } from './services';

const USE = PERMISSIONS.use;
const REPORTING = PERMISSIONS.reporting;
const tags = ['Projects: status reporting'];
const keyParams = z.object({ key: z.string().min(1).max(64) });
const idParams = z.object({ id: z.uuid() });
const templateParams = z.object({ id: z.string().trim().min(1).max(64) });

export function statusRoutes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);

  /* ───────────── schedule ───────────── */

  app.get(
    '/reporting/schedule',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: "The organisation's status reporting schedule, with the open and next periods",
        response: { 200: statusScheduleSchema },
      },
    },
    async (req) => s.reporting.dto(req.auth),
  );

  app.put(
    '/reporting/schedule',
    {
      config: { permission: REPORTING },
      schema: {
        tags,
        summary: 'Set the reporting schedule (PMO): cadence, due day, who reports, reminders',
        body: statusScheduleInputSchema,
        response: { 200: statusScheduleSchema },
      },
    },
    async (req) => {
      await s.reporting.updateSchedule(req.body, req.auth);
      await s.reporting.refreshSoon();
      return s.reporting.dto(req.auth);
    },
  );

  /* ───────────── status updates ───────────── */

  app.get(
    '/projects/:key/status-updates',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: "A project's updates: the open period's (owed and sent), yours, and earlier ones (paged)",
        params: keyParams,
        querystring: statusUpdateHistoryQuerySchema,
        response: { 200: projectStatusUpdatesSchema },
      },
    },
    async (req) => s.statusUpdates.forProject(req.params.key, req.query, req.auth),
  );

  app.post(
    '/projects/:key/status-updates',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'Send your status update for the open period (a manager’s update also sets the project’s health)',
        params: keyParams,
        body: statusUpdateInputSchema,
        response: { 201: statusUpdateSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await s.statusUpdates.post(req.params.key, req.body, req.auth)),
  );

  app.post(
    '/projects/:key/status-updates/draft',
    {
      config: { permission: USE, rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: {
        tags,
        summary:
          'Draft your update from the period’s tasks, milestones and meetings (AI or builtin; nothing is stored)',
        params: keyParams,
        response: { 200: statusDraftSchema },
      },
    },
    async (req) => s.statusUpdates.draft(req.params.key, req.auth),
  );

  app.patch(
    '/status-updates/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Change your sent update while its period is open',
        params: idParams,
        body: statusUpdatePatchSchema,
        response: { 200: statusUpdateSchema },
      },
    },
    async (req) => s.statusUpdates.edit(req.params.id, req.body, req.auth),
  );

  app.get(
    '/status-updates',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Who sent their update for a period (PMO and portfolio readers), with counts per standing',
        querystring: complianceQuerySchema,
        response: { 200: complianceSchema },
      },
    },
    async (req) => {
      const r = await s.reporting.compliance(req.query, req.auth);
      return {
        period: r.period,
        previousKey: r.previousKey,
        nextKey: r.nextKey,
        counts: r.counts,
        items: await s.statusUpdates.toDtos(r.rows, req.auth),
        total: r.total,
        page: r.page,
        pageSize: r.pageSize,
      };
    },
  );

  /* ───────────── the status report ───────────── */

  app.get(
    '/status-report',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'The status report of a period for the projects you can see, laid out by a template',
        querystring: statusReportQuerySchema,
        response: { 200: statusReportSchema },
      },
    },
    async (req) => s.reports.build(req.query, req.auth),
  );

  app.get(
    '/status-report/export',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'The status report as a Markdown file in your language',
        querystring: statusReportQuerySchema,
      },
    },
    async (req, reply) => {
      const report = await s.reports.build(req.query, req.auth);
      reply.header('content-type', 'text/markdown; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="status-report-${report.period.key}.md"`);
      return reply.send(s.reports.markdown(report, req.auth.user?.locale));
    },
  );

  /* ───────────── report templates ───────────── */

  app.get(
    '/report-templates',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Report templates (archived ones too, for the PMO, with archived=true)',
        querystring: reportTemplateQuerySchema,
        response: { 200: z.object({ items: z.array(reportTemplateSchema) }) },
      },
    },
    async (req) => ({
      items: await s.templates.list({
        archived: Boolean(req.query.archived) && canManageTemplates(req.auth),
      }),
    }),
  );

  app.get(
    '/report-templates/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'A report template by id or key',
        params: templateParams,
        response: { 200: reportTemplateSchema },
      },
    },
    async (req) => s.templates.get(req.params.id),
  );

  app.post(
    '/report-templates',
    {
      config: { permission: REPORTING },
      schema: {
        tags,
        summary: 'New report template (PMO)',
        body: reportTemplateInputSchema,
        response: { 201: reportTemplateSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s.templates.create(req.body, req.auth)),
  );

  app.put(
    '/report-templates/:id',
    {
      config: { permission: REPORTING },
      schema: {
        tags,
        summary: 'Replace a report template (its key stays)',
        params: templateParams,
        body: reportTemplateInputSchema,
        response: { 200: reportTemplateSchema },
      },
    },
    async (req) => s.templates.update(req.params.id, req.body, req.auth),
  );

  for (const [path, archived] of [
    ['archive', true],
    ['restore', false],
  ] as const)
    app.post(
      `/report-templates/:id/${path}`,
      {
        config: { permission: REPORTING },
        schema: {
          tags,
          summary: archived ? 'Archive a report template' : 'Restore an archived report template',
          params: templateParams,
          response: { 200: reportTemplateSchema },
        },
      },
      async (req) => s.templates.setArchived(req.params.id, archived, req.auth),
    );

  /* ───────────── lookups ───────────── */

  app.get(
    '/lookups/groups',
    {
      config: { permission: REPORTING },
      schema: {
        tags,
        summary: 'Groups to pick as reporters or recipients (id, key, name)',
        querystring: lookupQuerySchema.extend({ keys: z.string().max(2_000).optional() }),
        response: {
          200: z.object({ items: z.array(z.object({ id: z.uuid(), key: z.string(), name: z.string() })) }),
        },
      },
    },
    async (req) => {
      const keys = req.query.keys?.split(',').filter(Boolean).slice(0, 50) ?? [];
      return {
        items: await ctx.db
          .select({ id: groups.id, key: groups.key, name: groups.name })
          .from(groups)
          .where(
            keys.length
              ? inArray(groups.key, keys)
              : req.query.q
                ? or(
                    ilike(groups.name, likePattern(req.query.q)),
                    ilike(groups.key, likePattern(req.query.q)),
                  )
                : ne(groups.key, 'everyone'),
          )
          .orderBy(asc(groups.name))
          .limit(200),
      };
    },
  );
}
