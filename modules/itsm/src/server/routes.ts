import { localizedTextSchema } from '@isbp/sdk';
import { type ModuleContext, type ModuleRouter, httpErrors, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  acceptanceSchema,
  activityQuerySchema,
  activitySchema,
  assignmentGroupSchema,
  calendarQuerySchema,
  calendarSchema,
  catalogItemSchema,
  categoryQuerySchema,
  categorySchema,
  changeCalendarItemSchema,
  changeConflictSchema,
  commentSchema,
  confirmSchema,
  conflictQuerySchema,
  createLinkSchema,
  createTicketSchema,
  overviewReportSchema,
  personRefSchema,
  queueCountsSchema,
  reopenSchema,
  reportQuerySchema,
  slaPolicySchema,
  ticketDetailSchema,
  ticketListItemSchema,
  ticketQuerySchema,
  ticketTypeSchema,
  transitionSchema,
  updateChangeSchema,
  updateProblemSchema,
  updateTicketSchema,
  upsertCalendarSchema,
  upsertCatalogItemSchema,
  upsertCategorySchema,
  upsertSlaPolicySchema,
} from '../contracts';
import { hasAgentReach } from './access';
import { overviewReport } from './reports';
import { services } from './services';

const tags = ['Service desk'];
const configTags = ['Service desk configuration'];
const id = z.uuid();
const refParams = z.object({ ref: z.string().trim().min(1).max(64) });
const idParams = z.object({ id });
const linkParams = refParams.extend({ linkId: id });
const formKeyParams = z.object({ formKey: z.string().trim().min(1).max(64) });

/** Everyone in ITSM (requesters and every agent role) holds `itsm.tickets.create`; handlers check scope. */
const ANY = { permission: 'itsm.tickets.create', scoped: true } as const;
const CONFIG = { permission: 'itsm.config.manage' } as const;

/** PATCH bodies: every field optional and no defaults (absent = unchanged). */
const categoryPatchSchema = z
  .object({
    key: upsertCategorySchema.shape.key,
    name: localizedTextSchema,
    parentId: id.nullable(),
    ticketTypes: z.array(ticketTypeSchema).min(1),
    defaultGroupId: id.nullable(),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
  .partial();
const calendarPatchSchema = upsertCalendarSchema.partial();
const policyPatchSchema = upsertSlaPolicySchema.partial();

/** REST API mounted at /api/v1/itsm (see the endpoint list in contracts.ts). */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const { tickets: svc, config, calendar } = services(ctx);
  const detail = (ref: string, auth: Parameters<typeof svc.detail>[1]) => svc.detail(ref, auth);

  /* ───────────────────────────── tickets ───────────────────────────── */

  app.get(
    '/tickets',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Tickets the caller can see (own tickets for requesters; queues for agents)',
        querystring: ticketQuerySchema,
        response: { 200: pageSchema(ticketListItemSchema) },
      },
    },
    async (req) => svc.list(req.query, req.auth),
  );

  app.post(
    '/tickets',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Raise a ticket (requesters: incident or request; agents: anything, for anyone)',
        body: createTicketSchema,
        response: { 201: ticketDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await svc.create(req.body, req.auth);
      return reply.status(201).send(await svc.detailOf(row.id, req.auth));
    },
  );

  app.get(
    '/tickets/:ref',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'A ticket by id or reference (INC-00042)',
        params: refParams,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => detail(req.params.ref, req.auth),
  );

  app.patch(
    '/tickets/:ref',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Update classification, assignment, CIs or custom fields (agents)',
        params: refParams,
        body: updateTicketSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.update(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/tickets/:ref/transition',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Move a ticket to another status (resolve, fulfil and cancel need a resolution)',
        params: refParams,
        body: transitionSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.transition(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/tickets/:ref/assign-to-me',
    {
      config: ANY,
      schema: { tags, summary: 'Take a ticket', params: refParams, response: { 200: ticketDetailSchema } },
    },
    async (req) => {
      const row = await svc.assignToMe(req.params.ref, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.get(
    '/tickets/:ref/activities',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Timeline (requesters see the public conversation only)',
        params: refParams,
        querystring: activityQuerySchema,
        response: { 200: pageSchema(activitySchema) },
      },
    },
    async (req) => svc.activities(req.params.ref, req.query, req.auth),
  );

  app.post(
    '/tickets/:ref/comments',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Reply publicly, or add an internal work note (agents)',
        params: refParams,
        body: commentSchema,
        response: { 201: activitySchema },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.comment(req.params.ref, req.body, req.auth)),
  );

  app.post(
    '/tickets/:ref/links',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Link another ticket (problem ↔ incidents, change ↔ tickets, parent/child, duplicate)',
        params: refParams,
        body: createLinkSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.addLink(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.delete(
    '/tickets/:ref/links/:linkId',
    {
      config: ANY,
      schema: { tags, summary: 'Remove a link', params: linkParams, response: { 200: ticketDetailSchema } },
    },
    async (req) => {
      const row = await svc.removeLink(req.params.ref, req.params.linkId, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/tickets/:ref/reopen',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Requester: the problem is not fixed — back to the service desk',
        params: refParams,
        body: reopenSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.reopen(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/tickets/:ref/confirm',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Requester: confirm the fix and close the ticket (optional satisfaction rating)',
        params: refParams,
        body: confirmSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.confirm(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.post(
    '/tickets/:ref/acceptance',
    {
      config: ANY,
      schema: {
        tags,
        summary:
          'Change requester, in the post-implementation review: accept the change, or report a problem (with the reason)',
        params: refParams,
        body: acceptanceSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.accept(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.patch(
    '/tickets/:ref/problem',
    {
      config: { permission: 'itsm.problems.manage' },
      schema: {
        tags,
        summary: 'Root cause, workaround and known error of a problem',
        params: refParams,
        body: updateProblemSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.updateProblem(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.patch(
    '/tickets/:ref/change',
    {
      config: { permission: 'itsm.changes.manage' },
      schema: {
        tags,
        summary: 'Plan a change: type, risk, window, implementation, back-out and test plans',
        params: refParams,
        body: updateChangeSchema,
        response: { 200: ticketDetailSchema },
      },
    },
    async (req) => {
      const row = await svc.updateChange(req.params.ref, req.body, req.auth);
      return svc.detailOf(row.id, req.auth);
    },
  );

  app.get(
    '/queues',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Open-ticket counts for the agent views',
        response: { 200: queueCountsSchema },
      },
    },
    async (req) => svc.queues(req.auth),
  );

  /* ───────────────────────────── changes ───────────────────────────── */

  app.get(
    '/changes/calendar',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Changes planned in a window (change calendar)',
        querystring: calendarQuerySchema,
        response: { 200: z.object({ items: z.array(changeCalendarItemSchema) }) },
      },
    },
    async (req) => calendar.calendar(req.query, req.auth),
  );

  app.get(
    '/changes/conflicts',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Changes touching the same CIs in an overlapping window',
        querystring: conflictQuerySchema,
        response: { 200: z.object({ items: z.array(changeConflictSchema) }) },
      },
    },
    async (req) => calendar.conflicts(req.query, req.auth),
  );

  /* ───────────────────────────── lookups ───────────────────────────── */

  app.get(
    '/groups',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Assignment groups (core groups) with member counts',
        response: { 200: z.object({ items: z.array(assignmentGroupSchema) }) },
      },
    },
    async (req) => {
      if (!hasAgentReach(req.auth)) throw httpErrors.forbidden('Assignment groups are for agents');
      return config.groups();
    },
  );

  app.get(
    '/groups/:id/agents',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Members of a group who can work tickets',
        params: idParams,
        response: { 200: z.object({ items: z.array(personRefSchema) }) },
      },
    },
    async (req) => {
      if (!hasAgentReach(req.auth)) throw httpErrors.forbidden('Assignment groups are for agents');
      return config.groupAgents(req.params.id);
    },
  );

  app.get(
    '/categories',
    {
      config: ANY,
      schema: {
        tags,
        summary: 'Ticket categories (tree, with default groups)',
        querystring: categoryQuerySchema,
        response: { 200: z.object({ items: z.array(categorySchema) }) },
      },
    },
    async (req) => config.categories(req.query),
  );

  /* ───────────────────────────── configuration ───────────────────────────── */

  app.post(
    '/categories',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Add a category',
        body: upsertCategorySchema,
        response: { 201: categorySchema },
      },
    },
    async (req, reply) => reply.status(201).send(await config.createCategory(req.body)),
  );

  app.patch(
    '/categories/:id',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Edit a category',
        params: idParams,
        body: categoryPatchSchema,
        response: { 200: categorySchema },
      },
    },
    async (req) => config.updateCategory(req.params.id, req.body),
  );

  app.delete(
    '/categories/:id',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Delete an unused category',
        params: idParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await config.deleteCategory(req.params.id);
      return reply.status(204).send();
    },
  );

  app.get(
    '/calendars',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Business calendars',
        response: { 200: z.object({ items: z.array(calendarSchema) }) },
      },
    },
    async () => config.calendars(),
  );

  app.post(
    '/calendars',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Add a business calendar',
        body: upsertCalendarSchema,
        response: { 201: calendarSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await config.createCalendar(req.body)),
  );

  app.patch(
    '/calendars/:id',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Edit a business calendar',
        params: idParams,
        body: calendarPatchSchema,
        response: { 200: calendarSchema },
      },
    },
    async (req) => config.updateCalendar(req.params.id, req.body),
  );

  app.delete(
    '/calendars/:id',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Delete an unused calendar',
        params: idParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await config.deleteCalendar(req.params.id);
      return reply.status(204).send();
    },
  );

  app.get(
    '/sla-policies',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'SLA policies in evaluation order',
        response: { 200: z.object({ items: z.array(slaPolicySchema) }) },
      },
    },
    async () => config.policies(),
  );

  app.post(
    '/sla-policies',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Add an SLA policy',
        body: upsertSlaPolicySchema,
        response: { 201: slaPolicySchema },
      },
    },
    async (req, reply) => reply.status(201).send(await config.createPolicy(req.body)),
  );

  app.patch(
    '/sla-policies/:id',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Edit an SLA policy (applies to tickets raised afterwards)',
        params: idParams,
        body: policyPatchSchema,
        response: { 200: slaPolicySchema },
      },
    },
    async (req) => config.updatePolicy(req.params.id, req.body),
  );

  app.delete(
    '/sla-policies/:id',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Delete an unused SLA policy',
        params: idParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await config.deletePolicy(req.params.id);
      return reply.status(204).send();
    },
  );

  app.get(
    '/catalog',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Published forms and how the service desk fulfils them',
        response: { 200: z.object({ items: z.array(catalogItemSchema) }) },
      },
    },
    async () => config.catalog(),
  );

  app.put(
    '/catalog/:formKey',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Fulfil a form through the service desk',
        params: formKeyParams,
        body: upsertCatalogItemSchema,
        response: { 200: catalogItemSchema },
      },
    },
    async (req) => config.upsertCatalogItem(req.params.formKey, req.body),
  );

  app.delete(
    '/catalog/:formKey',
    {
      config: CONFIG,
      schema: {
        tags: configTags,
        summary: 'Stop fulfilling a form',
        params: formKeyParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await config.deleteCatalogItem(req.params.formKey);
      return reply.status(204).send();
    },
  );

  /* ───────────────────────────── reports ───────────────────────────── */

  app.get(
    '/reports/overview',
    {
      config: { permission: 'itsm.reports.read' },
      schema: {
        tags,
        summary: 'Volumes, SLA attainment, MTTR, backlog age, top categories and CSAT',
        querystring: reportQuerySchema,
        response: { 200: overviewReportSchema },
      },
    },
    async (req) => overviewReport(ctx, req.query.days, req.auth.user?.timezone ?? 'UTC'),
  );
}
