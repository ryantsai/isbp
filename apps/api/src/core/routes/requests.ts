import {
  accessRequestPreviewInputSchema,
  accessRequestQuerySchema,
  approvalPreviewSchema,
  accessRequestSchema,
  cancelSchema,
  catalogItemSchema,
  createAccessRequestSchema,
  formSubmissionSchema,
  myRequestQuerySchema,
  myRequestSchema,
  parseRequestNumber,
  portalEntrySchema,
  publishedFormSchema,
  requestableRoleQuerySchema,
  requestableRoleSchema,
  requestPathSchema,
  submitFormSchema,
} from '@isbp/contracts';
import { httpErrors, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import { getKernel } from '../kernel-ref';
import type { AccessRequestService } from '../services/access-requests';
import type { FormService } from '../services/forms';

const idParams = z.object({ id: z.uuid() });
/** A form assignment (to-do) the request is for. */
const assignmentQuery = z.object({ assignment: z.uuid().optional() });

/** The self-service portal: request access, fill in forms, follow "My requests". */
export function requestRoutes(app: ModuleRouter, access: AccessRequestService, forms: FormService) {
  const tags = ['Requests'];

  app.get(
    '/portal/entries',
    {
      schema: {
        tags,
        summary: "Modules' cards for the portal's “What do you need?” (enabled modules, your permissions)",
        response: { 200: z.object({ items: z.array(portalEntrySchema) }) },
      },
    },
    async (req) => ({
      items: getKernel()
        .registry.enabledModules()
        .flatMap((m) =>
          (m.manifest.portal?.entries ?? [])
            .filter((e) => !e.permission || req.auth.permissions.hasAny(e.permission))
            .map((e) => ({
              moduleId: m.manifest.id,
              id: e.id,
              label: e.label,
              description: e.description ?? null,
              icon: e.icon ?? 'circle-help',
              href: e.href,
              order: e.order ?? 100,
            })),
        )
        .sort((a, b) => a.order - b.order),
    }),
  );

  app.get(
    '/requestable-roles',
    {
      schema: {
        tags,
        summary: 'Roles people can request through the portal',
        querystring: requestableRoleQuerySchema,
        response: { 200: z.object({ items: z.array(requestableRoleSchema) }) },
      },
    },
    async (req) => ({ items: await access.requestable(req.query, req.auth) }),
  );

  app.post(
    '/access-requests',
    {
      schema: {
        tags,
        summary: 'Request a role (for yourself or a direct report); starts the approval workflow',
        body: createAccessRequestSchema,
        response: { 201: accessRequestSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await access.create(req.body, req.auth)),
  );

  app.post(
    '/access-requests/preview',
    {
      schema: {
        tags,
        summary: 'Who would approve this request (dry run, nothing is saved)',
        body: accessRequestPreviewInputSchema,
        response: { 200: approvalPreviewSchema },
      },
    },
    async (req) => access.preview(req.body, req.auth),
  );

  app.get(
    '/access-requests',
    {
      schema: {
        tags,
        summary: 'Access requests — mine, or all within your reach (core.access-requests.read)',
        querystring: accessRequestQuerySchema,
        response: { 200: pageSchema(accessRequestSchema) },
      },
    },
    async (req) => access.list(req.query, req.auth),
  );

  app.get(
    '/access-requests/:id',
    {
      schema: {
        tags,
        summary: 'An access request',
        params: idParams,
        response: { 200: accessRequestSchema },
      },
    },
    async (req) => access.get(req.params.id, req.auth),
  );

  app.post(
    '/access-requests/:id/cancel',
    {
      schema: {
        tags,
        summary: 'Withdraw a pending access request',
        params: idParams,
        body: cancelSchema,
        response: { 200: accessRequestSchema },
      },
    },
    async (req) => access.cancel(req.params.id, req.body.reason, req.auth),
  );

  app.get(
    '/me/requests',
    {
      schema: {
        tags,
        summary: 'My access requests and form submissions',
        querystring: myRequestQuerySchema,
        response: { 200: pageSchema(myRequestSchema) },
      },
    },
    async (req) => access.mine(req.query, req.auth),
  );

  app.get(
    '/requests/:reference',
    {
      schema: {
        tags,
        summary: 'Look up a request by its number (REQ-01042)',
        params: z.object({ reference: z.string().max(20) }),
        response: {
          200: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('access'), request: accessRequestSchema }),
            z.object({ kind: z.literal('form'), submission: formSubmissionSchema }),
          ]),
        },
      },
    },
    async (req) => {
      const n = parseRequestNumber(req.params.reference);
      if (n === null) throw httpErrors.notFound('Request not found');
      const request = await access.byNumber(n, req.auth).catch(() => null);
      if (request) return { kind: 'access' as const, request };
      const submission = await forms.byNumber(n, req.auth).catch(() => null);
      if (submission) return { kind: 'form' as const, submission };
      throw httpErrors.notFound('Request not found');
    },
  );

  app.get(
    '/requests/:reference/path',
    {
      schema: {
        tags,
        summary:
          'Who approves a request, step by step, as the requester sees it (done, waiting, next): no rule text',
        params: z.object({ reference: z.string().max(20) }),
        response: { 200: requestPathSchema },
      },
    },
    async (req) => {
      const n = parseRequestNumber(req.params.reference);
      if (n === null) throw httpErrors.notFound('Request not found');
      const path =
        (await access.pathByNumber(n, req.auth).catch(() => null)) ??
        (await forms.pathByNumber(n, req.auth).catch(() => null));
      if (!path) throw httpErrors.notFound('Request not found');
      return path;
    },
  );

  app.get(
    '/workflow-instances/:id/path',
    {
      schema: {
        tags,
        summary:
          'The approval path of an instance, step by step, for the people who can see it (approvers, requesters)',
        params: idParams,
        response: { 200: requestPathSchema },
      },
    },
    async (req) => access.instancePath(req.params.id, req.auth),
  );

  /* ───────────── forms (portal) ───────────── */

  app.get(
    '/forms/catalog',
    {
      schema: {
        tags,
        summary: 'Forms I can submit',
        response: { 200: z.object({ items: z.array(catalogItemSchema) }) },
      },
    },
    async (req) => ({ items: await forms.catalog(req.auth) }),
  );

  app.get(
    '/forms/by-key/:key',
    {
      schema: {
        tags,
        summary:
          'Published version of a form, for filling in (`assignment`: your open to-do for it, whatever its audience)',
        params: z.object({ key: z.string().max(100) }),
        querystring: assignmentQuery,
        response: { 200: publishedFormSchema },
      },
    },
    async (req) => forms.published(req.params.key, req.auth, req.query.assignment),
  );

  app.post(
    '/forms/by-key/:key/submissions',
    {
      schema: {
        tags,
        summary:
          'Submit a form (validated server-side, hidden fields dropped); starts its workflow. `assignment`: the to-do it completes',
        params: z.object({ key: z.string().max(100) }),
        querystring: assignmentQuery,
        body: submitFormSchema,
        response: { 201: formSubmissionSchema },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await forms.submit(req.params.key, req.body.data, req.auth, { assignmentId: req.query.assignment }),
        ),
  );

  app.post(
    '/forms/by-key/:key/preview',
    {
      schema: {
        tags,
        summary: 'Who would approve these answers (dry run of the attached workflow, nothing is saved)',
        params: z.object({ key: z.string().max(100) }),
        querystring: assignmentQuery,
        body: submitFormSchema,
        response: { 200: approvalPreviewSchema },
      },
    },
    async (req) => forms.preview(req.params.key, req.body.data, req.auth, req.query.assignment),
  );

  app.get(
    '/form-submissions/:id',
    {
      schema: {
        tags,
        summary: 'A form submission',
        params: idParams,
        response: { 200: formSubmissionSchema },
      },
    },
    async (req) => forms.submission(req.params.id, req.auth),
  );

  app.post(
    '/form-submissions/:id/cancel',
    {
      schema: {
        tags,
        summary: 'Withdraw a pending submission',
        params: idParams,
        body: cancelSchema,
        response: { 200: formSubmissionSchema },
      },
    },
    async (req) => forms.cancel(req.params.id, req.body.reason, req.auth),
  );

  app.post(
    '/form-submissions/:id/actions/:runId/retry',
    {
      config: { permission: 'core.forms.manage' },
      schema: {
        tags,
        summary: 'Run a failed (or skipped) process action of a request again',
        params: z.object({ id: z.uuid(), runId: z.uuid() }),
        response: { 200: formSubmissionSchema },
      },
    },
    async (req) => forms.retryAction(req.params.id, req.params.runId, req.auth),
  );
}
