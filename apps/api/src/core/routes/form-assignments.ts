import {
  cancelFormAssignmentSchema,
  createFormAssignmentSchema,
  formAssignmentComplianceSchema,
  formAssignmentOptionsSchema,
  formAssignmentQuerySchema,
  formAssignmentSchema,
  formSubmissionSchema,
  myFormAssignmentQuerySchema,
  submitFormSchema,
} from '@isbp/contracts';
import { type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import type { FormAssignmentService } from '../services/form-assignments';
import type { FormService } from '../services/forms';

const idParams = z.object({ id: z.uuid() });

/**
 * Assigned and recurring forms: form administrators assign a form to a person or group by a date (or a
 * `core.assign-form` job does, once per period); assignees see them under "To do" and complete them by submitting the
 * form with the assignment.
 */
export function formAssignmentRoutes(app: ModuleRouter, svc: FormAssignmentService, forms: FormService) {
  const tags = ['Form assignments'];
  const manage = { permission: 'core.forms.manage' };

  app.get(
    '/form-assignments/options',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Forms that can be assigned, and groups to assign them to',
        response: { 200: formAssignmentOptionsSchema },
      },
    },
    async () => svc.options(),
  );

  app.get(
    '/forms/:id/assignments',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Assignments of a form (state: open, overdue, done, late, cancelled; period; q on the title)',
        params: idParams,
        querystring: formAssignmentQuerySchema,
        response: { 200: pageSchema(formAssignmentSchema) },
      },
    },
    async (req) => svc.list(req.params.id, req.query),
  );

  app.post(
    '/forms/:id/assignments',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Assign a published form to a person or a group, due by a date (notifies them)',
        params: idParams,
        body: createFormAssignmentSchema,
        response: { 201: formAssignmentSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await svc.create(req.params.id, req.body, req.auth)),
  );

  app.get(
    '/forms/:id/assignments/compliance',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Per period (latest 12): done on time, late, overdue, open and cancelled assignments',
        params: idParams,
        response: { 200: formAssignmentComplianceSchema },
      },
    },
    async (req) => svc.compliance(req.params.id),
  );

  app.post(
    '/form-assignments/:id/cancel',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Cancel an open assignment',
        params: idParams,
        body: cancelFormAssignmentSchema,
        response: { 200: formAssignmentSchema },
      },
    },
    async (req) => svc.cancel(req.params.id, req.body.reason, req.auth),
  );

  /* ───────────── the assignee (people only) ───────────── */

  app.get(
    '/me/form-assignments',
    {
      schema: {
        tags,
        summary: 'My to-dos: forms assigned to me or to my groups (open by default, soonest due first)',
        querystring: myFormAssignmentQuerySchema,
        response: { 200: pageSchema(formAssignmentSchema) },
      },
    },
    async (req) => svc.mine(req.query, req.auth),
  );

  app.get(
    '/me/form-assignments/:id',
    {
      schema: {
        tags,
        summary: 'One of my to-dos',
        params: idParams,
        response: { 200: formAssignmentSchema },
      },
    },
    async (req) => svc.mineOne(req.params.id, req.auth),
  );

  app.post(
    '/me/form-assignments/:id/submissions',
    {
      schema: {
        tags,
        summary: 'Fill in the form of one of my to-dos (the same as submitting the form with ?assignment=)',
        params: idParams,
        body: submitFormSchema,
        response: { 201: formSubmissionSchema },
      },
    },
    async (req, reply) => {
      const a = await svc.mineOne(req.params.id, req.auth);
      return reply
        .status(201)
        .send(await forms.submit(a.form.key, req.body.data, req.auth, { assignmentId: a.id }));
    },
  );
}
