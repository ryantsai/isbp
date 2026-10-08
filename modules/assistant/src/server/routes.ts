import { fieldDefSchema } from '@isbp/sdk';
import { ErrorCodes, HttpError, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  applySchema,
  assistantStatusSchema,
  buildTemplateSchema,
  changeSetDetailSchema,
  changeSetPackageSchema,
  changeSetQuerySchema,
  changeSetSummarySchema,
  conversationDetailSchema,
  confirmSchema,
  conversationSchema,
  createChangeSetSchema,
  packageFileName,
  packageListSchema,
  proposeItemSchema,
  rollbackSchema,
  sendMessageSchema,
  submitSchema,
  updateChangeSetSchema,
} from '../contracts';
import { formatSse } from '../lib/sse';
import { ChangeSetService } from './change-sets';
import { ChatService } from './chat';

const idParams = z.object({ id: z.uuid() });
const HEARTBEAT_MS = 15_000;
const USE = 'assistant.agent.use';
/** A package of 300 items with full forms and workflows fits; the default body limit is 1 MB. */
const PACKAGE_BODY_LIMIT = 4 * 1024 * 1024;

/** REST API mounted at /api/v1/assistant. */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const sets = new ChangeSetService(ctx);
  const chat = new ChatService(ctx);
  const tags = ['Assistant'];
  const detail = { 200: changeSetDetailSchema };

  app.get(
    '/status',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Mode (chat model or guided templates), the kinds you may propose and the tools you may use',
        response: { 200: assistantStatusSchema },
      },
    },
    async (req) => {
      const status = await ctx.ai.status();
      return {
        mode: status.chat.available ? ('llm' as const) : ('builtin' as const),
        model: status.chat.available ? status.chat.model : null,
        // Everyday work goes through other modules' tools; the assistant's own are about configuration.
        tools: ctx.ai.tools.list(req.auth).filter((t) => t.moduleId !== 'assistant').length,
        kinds: ctx.customizations.kinds(req.auth).map((k) => ({
          kind: k.kind,
          moduleId: k.moduleId,
          label: k.label,
          description: k.description,
          icon: k.icon,
          operations: k.operations,
          canApply: k.canApply,
          templates: k.templates,
        })),
      };
    },
  );

  /* ───────────── conversations ───────────── */

  app.get(
    '/conversations',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'My recent conversations',
        response: { 200: z.object({ items: z.array(conversationSchema) }) },
      },
    },
    async (req) => ({ items: await chat.list(req.auth) }),
  );

  app.post(
    '/conversations',
    {
      config: { permission: USE },
      schema: { tags, summary: 'Start a conversation', response: { 201: z.object({ id: z.uuid() }) } },
    },
    async (req, reply) => reply.status(201).send(await chat.create(req.auth)),
  );

  app.get(
    '/conversations/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'A conversation with its messages',
        params: idParams,
        response: { 200: conversationDetailSchema },
      },
    },
    async (req) => chat.get(req.params.id, req.auth),
  );

  app.post(
    '/conversations/:id/messages',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Ask the assistant (answer streamed as text/event-stream)',
        description:
          'Events: `delta {text}`, `tool {name, status}`, `change_set {…summary}`, `done {messageId, mode, model}`, `error {code}`.',
        params: idParams,
        body: sendMessageSchema,
      },
    },
    async (req, reply) => {
      const turn = await chat.prepareTurn(req.params.id, req.body.content, req.body.page ?? null, req.auth);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const open = () => !res.writableEnded && !res.destroyed;
      const heartbeat = setInterval(() => open() && res.write(': ping\n\n'), HEARTBEAT_MS);
      try {
        // The answer is generated and stored even if the client goes away mid-stream.
        for await (const evt of chat.streamTurn(turn)) if (open()) res.write(formatSse(evt.event, evt.data));
      } catch (err) {
        req.log.error({ err }, 'assistant stream failed');
        if (open()) res.write(formatSse('error', { code: 'INTERNAL' }));
      } finally {
        clearInterval(heartbeat);
        if (open()) res.end();
      }
    },
  );

  app.post(
    '/conversations/:id/confirmations/:toolCallId',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Confirm or decline a destructive action the assistant asked to take (it then runs as you)',
        params: z.object({ id: z.uuid(), toolCallId: z.string().min(1).max(200) }),
        body: confirmSchema,
        response: { 200: conversationDetailSchema },
      },
    },
    async (req) => chat.confirm(req.params.id, req.params.toolCallId, req.body.approve, req.auth),
  );

  /* ───────────── change sets ───────────── */

  app.get(
    '/change-sets',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Change sets: mine, or all with assistant.change-sets.read',
        querystring: changeSetQuerySchema,
        response: { 200: pageSchema(changeSetSummarySchema) },
      },
    },
    async (req) => sets.list(req.query, req.auth),
  );

  app.post(
    '/change-sets',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Start an empty change set',
        body: createChangeSetSchema,
        response: { 201: changeSetDetailSchema },
      },
    },
    async (req, reply) => {
      const row = await sets.create(req.body, req.auth);
      return reply.status(201).send(await sets.detail(row.id, req.auth));
    },
  );

  app.post(
    '/change-sets/import',
    {
      // Each import dry-runs up to 300 changes.
      config: { permission: USE, rateLimit: { max: 20, timeWindow: '1 minute' } },
      bodyLimit: PACKAGE_BODY_LIMIT,
      schema: {
        tags,
        summary: 'Import a change-set package: a new draft change set with its items, dry-run',
        description:
          'The body is an `isbp.change-set-package` (version 1, at most 300 items). Every item is checked like a ' +
          'proposal (`/change-sets/{id}/items`); nothing is created when one fails: 400 `PACKAGE_UNSUPPORTED` ' +
          '(`missingModules`, `unknownKinds`), 403 (kinds you cannot read), 422 `VALIDATION_FAILED` (`issues`).',
        body: changeSetPackageSchema,
        response: { 201: changeSetDetailSchema },
      },
    },
    async (req, reply) => {
      const id = await sets.importPackage(req.body, req.auth, { type: 'file' });
      return reply.status(201).send(await sets.detail(id, req.auth));
    },
  );

  app.get(
    '/change-sets/:id/export',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'The change set as a package (`isbp.change-set-package`), as a file download',
        params: idParams,
        response: { 200: changeSetPackageSchema },
      },
    },
    async (req, reply) => {
      const { reference, pkg } = await sets.exportPackage(req.params.id, req.auth);
      return reply
        .header('content-disposition', `attachment; filename="${packageFileName(reference)}"`)
        .header('cache-control', 'no-store')
        .send(pkg);
    },
  );

  app.get(
    '/change-sets/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'A change set with its items, current objects, dry run and what you may do',
        params: idParams,
        response: detail,
      },
    },
    async (req) => sets.detail(req.params.id, req.auth),
  );

  app.patch(
    '/change-sets/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Rename or describe a draft',
        params: idParams,
        body: updateChangeSetSchema,
        response: detail,
      },
    },
    async (req) => sets.update(req.params.id, req.body, req.auth),
  );

  app.post(
    '/change-sets/:id/items',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Propose a change (replaces the item with the same ref or target), then dry-run the set',
        params: idParams,
        body: proposeItemSchema,
        response: detail,
      },
    },
    async (req) => {
      await sets.propose(req.params.id, req.body, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.delete(
    '/change-sets/:id/items/:itemId',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Remove a proposed change',
        params: z.object({ id: z.uuid(), itemId: z.uuid() }),
        response: detail,
      },
    },
    async (req) => {
      await sets.removeItem(req.params.id, req.params.itemId, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/change-sets/:id/check',
    {
      config: { permission: USE },
      schema: { tags, summary: 'Dry-run the change set again', params: idParams, response: detail },
    },
    async (req) => {
      await sets.load(req.params.id, req.auth);
      await sets.dryRun(req.params.id, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/change-sets/:id/refresh',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Accept the objects’ current versions as the base (after someone else changed them)',
        params: idParams,
        response: detail,
      },
    },
    async (req) => sets.refresh(req.params.id, req.auth),
  );

  app.post(
    '/change-sets/:id/apply',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Apply every change in one transaction (needs each kind’s apply permission)',
        params: idParams,
        body: applySchema,
        response: detail,
      },
    },
    async (req) => {
      await sets.apply(req.params.id, req.body, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/change-sets/:id/submit',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Request a review (starts the assistant.change-set workflow)',
        params: idParams,
        body: submitSchema,
        response: detail,
      },
    },
    async (req) => {
      await sets.submit(req.params.id, req.body, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/change-sets/:id/withdraw',
    {
      config: { permission: USE },
      schema: { tags, summary: 'Withdraw the review request', params: idParams, response: detail },
    },
    async (req) => {
      await sets.withdraw(req.params.id, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/change-sets/:id/rollback',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Undo an applied change set in one transaction',
        params: idParams,
        body: rollbackSchema,
        response: detail,
      },
    },
    async (req) => {
      await sets.rollback(req.params.id, req.body, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/change-sets/:id/discard',
    {
      config: { permission: USE },
      schema: { tags, summary: 'Discard a draft', params: idParams, response: detail },
    },
    async (req) => {
      await sets.discard(req.params.id, req.auth);
      return sets.detail(req.params.id, req.auth);
    },
  );

  /* ───────────── built-in packages ───────────── */

  app.get(
    '/packages',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Built-in packages of enabled modules, with what installing each needs and whether you may',
        response: { 200: packageListSchema },
      },
    },
    async (req) => ({ items: await ctx.customizations.packages(req.auth) }),
  );

  app.post(
    '/packages/:module/:key/install',
    {
      config: { permission: USE, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Install a built-in package: a new draft change set with its items, dry-run (as an import)',
        params: z.object({ module: z.string().max(40), key: z.string().max(60) }),
        response: { 201: changeSetDetailSchema },
      },
    },
    async (req, reply) => {
      const { module, key } = req.params;
      // Built in the installer's language, as the change set's title is (plain-text names and messages).
      const locale = req.auth.user?.locale ?? 'en';
      const parsed = changeSetPackageSchema.safeParse(
        await ctx.customizations.loadPackage(module, key, { locale }),
      );
      // A module's own package that doesn't parse is a bug in that module: say where.
      if (!parsed.success)
        throw new HttpError(
          422,
          ErrorCodes.VALIDATION_FAILED,
          `The built-in package ${module}/${key} is invalid`,
          {
            issues: parsed.error.issues.slice(0, 50).map((i) => ({
              path: i.path.join('.'),
              message: i.message,
              code: i.code,
            })),
          },
        );
      const id = await sets.importPackage(parsed.data, req.auth, { type: 'package', moduleId: module, key });
      return reply.status(201).send(await sets.detail(id, req.auth));
    },
  );

  /* ───────────── guided templates (builtin mode) ───────────── */

  app.get(
    '/templates/:kind/:templateId',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'The questions of a guided template',
        params: z.object({ kind: z.string().max(100), templateId: z.string().max(100) }),
        response: { 200: z.object({ fields: z.array(fieldDefSchema) }) },
      },
    },
    async (req) => ({
      fields: await ctx.customizations.templateFields(req.params.kind, req.params.templateId, req.auth),
    }),
  );

  app.post(
    '/templates/build',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'Answer a guided template: its changes (one, or several that refer to each other) are added to a change set (a new one unless given)',
        body: buildTemplateSchema,
        response: detail,
      },
    },
    async (req) => {
      const { kind, templateId, answers, changeSetId } = req.body;
      const built = await ctx.customizations.buildTemplate(kind, templateId, answers, req.auth);
      // One change, or several referring to each other (the approval process: a workflow, then its form).
      const id = await sets.proposeTemplate(changeSetId ?? null, built, req.auth);
      return sets.detail(id, req.auth);
    },
  );
}
