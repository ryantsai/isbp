import {
  approvalItemSchema,
  approvalQuerySchema,
  cancelSchema,
  createDelegationSchema,
  createWorkflowSchema,
  decisionSchema,
  delegateTaskSchema,
  delegationSchema,
  instanceQuerySchema,
  okSchema,
  updateWorkflowSchema,
  workflowDefinitionSchema,
  workflowDefinitionSummarySchema,
  workflowInstanceSchema,
  workflowInstanceSummarySchema,
  workflowListQuerySchema,
  workflowTriggerSchema,
} from '@isbp/contracts';
import { type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import { getKernel } from '../kernel-ref';
import type { ApprovalService, WorkflowAdminService } from '../services/workflows';

const idParams = z.object({ id: z.uuid() });

export function workflowRoutes(app: ModuleRouter, admin: WorkflowAdminService, approvals: ApprovalService) {
  const tags = ['Workflows'];

  app.get(
    '/workflow-triggers',
    {
      config: { permission: 'core.workflows.read' },
      schema: {
        tags,
        summary: 'Attach points modules declare for approval workflows, with their facts',
        response: { 200: z.object({ items: z.array(workflowTriggerSchema) }) },
      },
    },
    async () => ({ items: await admin.triggers() }),
  );

  app.get(
    '/workflows',
    {
      config: { permission: 'core.workflows.read' },
      schema: {
        tags,
        summary: 'List workflow definitions',
        querystring: workflowListQuerySchema,
        response: { 200: z.object({ items: z.array(workflowDefinitionSummarySchema) }) },
      },
    },
    async (req) => ({ items: await admin.list(req.query) }),
  );

  app.post(
    '/workflows',
    {
      config: { permission: 'core.workflows.manage' },
      schema: {
        tags,
        summary: 'Create a workflow (draft)',
        body: createWorkflowSchema,
        response: { 201: workflowDefinitionSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await admin.create(req.body, req.auth)),
  );

  app.get(
    '/workflows/:id',
    {
      config: { permission: 'core.workflows.read' },
      schema: {
        tags,
        summary: 'Workflow definition with draft, versions and issues',
        params: idParams,
        response: { 200: workflowDefinitionSchema },
      },
    },
    async (req) => admin.get(req.params.id),
  );

  app.patch(
    '/workflows/:id',
    {
      config: { permission: 'core.workflows.manage' },
      schema: {
        tags,
        summary: 'Save the draft or rename',
        params: idParams,
        body: updateWorkflowSchema,
        response: { 200: workflowDefinitionSchema },
      },
    },
    async (req) => admin.update(req.params.id, req.body, req.auth),
  );

  app.post(
    '/workflows/:id/publish',
    {
      config: { permission: 'core.workflows.manage' },
      schema: {
        tags,
        summary: 'Publish the draft as a new immutable version (running instances keep theirs)',
        params: idParams,
        response: { 200: workflowDefinitionSchema },
      },
    },
    async (req) => admin.publish(req.params.id, req.auth),
  );

  app.post(
    '/workflows/:id/default',
    {
      config: { permission: 'core.workflows.manage' },
      schema: {
        tags,
        summary: 'Use this workflow for its trigger',
        params: idParams,
        response: { 200: workflowDefinitionSchema },
      },
    },
    async (req) => admin.makeDefault(req.params.id),
  );

  app.delete(
    '/workflows/:id/default',
    {
      config: { permission: 'core.workflows.manage' },
      schema: {
        tags,
        summary: 'Stop using this workflow for its trigger (optional triggers only)',
        params: idParams,
        response: { 200: workflowDefinitionSchema },
      },
    },
    async (req) => admin.clearDefault(req.params.id),
  );

  app.post(
    '/workflows/:id/archive',
    {
      config: { permission: 'core.workflows.manage' },
      schema: { tags, summary: 'Archive a workflow', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await admin.archive(req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/workflows/:id/restore',
    {
      config: { permission: 'core.workflows.manage' },
      schema: {
        tags,
        summary: 'Restore an archived workflow',
        params: idParams,
        response: { 200: workflowDefinitionSchema },
      },
    },
    async (req) => admin.restore(req.params.id),
  );

  app.get(
    '/workflow-instances',
    {
      config: { permission: 'core.workflows.read' },
      schema: {
        tags,
        summary: 'Monitor workflow instances',
        querystring: instanceQuerySchema,
        response: { 200: pageSchema(workflowInstanceSummarySchema) },
      },
    },
    async (req) => admin.instances(req.query),
  );

  app.get(
    '/workflow-instances/:id',
    {
      schema: {
        tags,
        summary: 'Instance with its path, tasks and timeline (requester, approvers and workflow readers)',
        params: idParams,
        response: { 200: workflowInstanceSchema },
      },
    },
    async (req) => admin.views.detail(req.params.id, req.auth),
  );

  app.post(
    '/workflow-instances/:id/cancel',
    {
      schema: {
        tags,
        summary: 'Withdraw a running instance (requester or workflow admin)',
        params: idParams,
        body: cancelSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      const detail = await admin.views.detail(req.params.id, req.auth);
      if (!detail.canCancel) req.auth.require('core.workflows.manage');
      await getKernel().workflows.cancel(req.params.id, req.body.reason ?? null, req.auth);
      return { ok: true as const };
    },
  );

  /* ───────────── approvals (personal inbox) ───────────── */

  const inboxTags = ['Approvals'];

  app.get(
    '/me/approvals',
    {
      schema: {
        tags: inboxTags,
        summary: 'My approval tasks (pending or decided)',
        querystring: approvalQuerySchema,
        response: { 200: pageSchema(approvalItemSchema) },
      },
    },
    async (req) => approvals.inbox(req.auth, req.query),
  );

  const outcome = z.object({ outcome: z.enum(['running', 'approved', 'rejected']) });

  app.post(
    '/approvals/:id/approve',
    {
      schema: {
        tags: inboxTags,
        summary:
          'Approve a task assigned to me; `data` fills in the step’s fields (400 VALIDATION_FAILED, issues under data.<key>)',
        params: idParams,
        body: decisionSchema,
        response: { 200: outcome },
      },
    },
    async (req) => ({
      outcome: await approvals.decide(req.params.id, 'approve', req.body.comment, req.auth, req.body.data),
    }),
  );

  app.post(
    '/approvals/:id/reject',
    {
      schema: {
        tags: inboxTags,
        summary:
          'Reject a task assigned to me (a comment is required; the step’s required fields only when it asks for them on rejection too)',
        params: idParams,
        body: decisionSchema,
        response: { 200: outcome },
      },
    },
    async (req) => ({
      outcome: await approvals.decide(req.params.id, 'reject', req.body.comment, req.auth, req.body.data),
    }),
  );

  app.post(
    '/approvals/:id/delegate',
    {
      schema: {
        tags: inboxTags,
        summary: 'Hand a task to someone else (workflow admins can reassign any task)',
        params: idParams,
        body: delegateTaskSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await approvals.delegate(req.params.id, req.body.userId, req.body.comment, req.auth);
      return { ok: true as const };
    },
  );

  app.get(
    '/me/delegations',
    {
      schema: {
        tags: inboxTags,
        summary: 'My out-of-office delegations',
        response: { 200: z.object({ items: z.array(delegationSchema) }) },
      },
    },
    async (req) => ({ items: await approvals.delegations(req.auth.user!.id) }),
  );

  app.post(
    '/me/delegations',
    {
      schema: {
        tags: inboxTags,
        summary: 'Send my new approvals to a colleague for a period',
        body: createDelegationSchema,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ id: (await approvals.createDelegation(req.auth.user!.id, req.body)).id }),
  );

  app.delete(
    '/me/delegations/:id',
    {
      schema: { tags: inboxTags, summary: 'End a delegation', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await approvals.deleteDelegation(req.auth.user!.id, req.params.id);
      return { ok: true as const };
    },
  );
}
