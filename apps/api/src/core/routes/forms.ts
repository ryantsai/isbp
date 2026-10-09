import {
  approvalPreviewSchema,
  createCustomFieldSchema,
  createFormSchema,
  formBuilderPreviewInputSchema,
  customFieldEntitySchema,
  customFieldQuerySchema,
  customFieldSchema,
  formDetailSchema,
  formListQuerySchema,
  formSummarySchema,
  okSchema,
  processActionCatalogInputSchema,
  processActionCatalogQuerySchema,
  processActionCatalogSchema,
  processChecksInputSchema,
  processChecksSchema,
  reorderCustomFieldsSchema,
  submissionQuerySchema,
  submissionSummarySchema,
  updateCustomFieldSchema,
  updateFormSchema,
} from '@isbp/contracts';
import { type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import type { CustomFieldAdminService, FormService } from '../services/forms';

const idParams = z.object({ id: z.uuid() });

export function formRoutes(app: ModuleRouter, formsSvc: FormService, fields: CustomFieldAdminService) {
  const tags = ['Forms'];
  const manage = { permission: 'core.forms.manage' };

  app.get(
    '/forms',
    {
      config: manage,
      schema: {
        tags,
        summary: 'List forms',
        querystring: formListQuerySchema,
        response: { 200: z.object({ items: z.array(formSummarySchema) }) },
      },
    },
    async (req) => ({ items: await formsSvc.list(req.query) }),
  );

  app.post(
    '/forms',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Create a form (empty draft)',
        body: createFormSchema,
        response: { 201: formDetailSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await formsSvc.create(req.body, req.auth)),
  );

  app.get(
    '/forms/:id',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Form with its draft and versions',
        params: idParams,
        response: { 200: formDetailSchema },
      },
    },
    async (req) => formsSvc.get(req.params.id),
  );

  app.patch(
    '/forms/:id',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Save the draft, settings, audience or attached workflow',
        params: idParams,
        body: updateFormSchema,
        response: { 200: formDetailSchema },
      },
    },
    async (req) => formsSvc.update(req.params.id, req.body, req.auth),
  );

  app.post(
    '/forms/checks',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Before you publish: whether the audience can see the records offered, and who the approval’s groups and roles hold',
        body: processChecksInputSchema,
        response: { 200: processChecksSchema },
      },
    },
    async (req) => formsSvc.processChecks(req.body),
  );

  app.post(
    '/forms/:id/preview',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Who would approve sample answers to the unsaved form and approval (nothing is saved)',
        params: idParams,
        body: formBuilderPreviewInputSchema,
        response: { 200: approvalPreviewSchema },
      },
    },
    async (req) => formsSvc.builderPreview(req.params.id, req.body, req.auth),
  );

  app.post(
    '/forms/:id/publish',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Publish the draft as a new version',
        params: idParams,
        response: { 200: formDetailSchema },
      },
    },
    async (req) => formsSvc.publish(req.params.id, req.auth),
  );

  app.post(
    '/forms/:id/archive',
    {
      config: manage,
      schema: { tags, summary: 'Archive a form', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await formsSvc.setArchived(req.params.id, true);
      return { ok: true as const };
    },
  );

  app.post(
    '/forms/:id/restore',
    {
      config: manage,
      schema: { tags, summary: 'Restore an archived form', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await formsSvc.setArchived(req.params.id, false);
      return { ok: true as const };
    },
  );

  app.get(
    '/forms/process-actions',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Process actions a form can run, with their configuration fields for the form’s saved draft',
        querystring: processActionCatalogQuerySchema,
        response: { 200: processActionCatalogSchema },
      },
    },
    async (req) => formsSvc.actionCatalog({ formId: req.query.formId }, req.auth),
  );

  app.post(
    '/forms/process-actions',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Process actions with their configuration fields for an unsaved draft (reads only)',
        body: processActionCatalogInputSchema,
        response: { 200: processActionCatalogSchema },
      },
    },
    async (req) => formsSvc.actionCatalog(req.body, req.auth),
  );

  app.get(
    '/forms/:id/submissions',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Submissions of a form',
        params: idParams,
        querystring: submissionQuerySchema,
        response: { 200: pageSchema(submissionSummarySchema) },
      },
    },
    async (req) => formsSvc.submissions(req.params.id, req.query),
  );

  /* ───────────── custom fields ───────────── */

  const cfTags = ['Custom fields'];
  const cfManage = { permission: 'core.custom-fields.manage' };

  app.get(
    '/custom-fields/entities',
    {
      config: cfManage,
      schema: {
        tags: cfTags,
        summary: 'Entity types that support custom fields',
        response: { 200: z.object({ items: z.array(customFieldEntitySchema) }) },
      },
    },
    async () => ({ items: await fields.entities() }),
  );

  app.get(
    '/custom-fields',
    {
      schema: {
        tags: cfTags,
        summary: 'Custom fields of an entity type (any signed-in user — needed to render forms)',
        querystring: customFieldQuerySchema,
        response: { 200: z.object({ items: z.array(customFieldSchema) }) },
      },
    },
    async (req) => {
      if (req.query.includeArchived) req.auth.require('core.custom-fields.manage');
      return { items: await fields.list(req.query.entityType, req.query.includeArchived) };
    },
  );

  app.post(
    '/custom-fields',
    {
      config: cfManage,
      schema: {
        tags: cfTags,
        summary: 'Add a custom field',
        body: createCustomFieldSchema,
        response: { 201: customFieldSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await fields.create(req.body, req.auth)),
  );

  app.patch(
    '/custom-fields/:id',
    {
      config: cfManage,
      schema: {
        tags: cfTags,
        summary: 'Edit a custom field (key and type are fixed)',
        params: idParams,
        body: updateCustomFieldSchema,
        response: { 200: customFieldSchema },
      },
    },
    async (req) => fields.update(req.params.id, req.body, req.auth),
  );

  app.post(
    '/custom-fields/:id/archive',
    {
      config: cfManage,
      schema: {
        tags: cfTags,
        summary: 'Retire a field (stored values are kept)',
        params: idParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await fields.setArchived(req.params.id, true);
      return { ok: true as const };
    },
  );

  app.post(
    '/custom-fields/:id/restore',
    {
      config: cfManage,
      schema: {
        tags: cfTags,
        summary: 'Restore a retired field',
        params: idParams,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await fields.setArchived(req.params.id, false);
      return { ok: true as const };
    },
  );

  app.put(
    '/custom-fields/order',
    {
      config: cfManage,
      schema: {
        tags: cfTags,
        summary: 'Reorder the fields of an entity type',
        body: reorderCustomFieldsSchema,
        response: { 200: z.object({ items: z.array(customFieldSchema) }) },
      },
    },
    async (req) => ({ items: await fields.reorder(req.body.entityType, req.body.ids) }),
  );
}
