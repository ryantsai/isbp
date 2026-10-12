import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  assistSchema,
  conversationDetailSchema,
  conversationQuerySchema,
  conversationSchema,
  createConversationSchema,
  escalateResultSchema,
  insightFeedbackSchema,
  kbDraftSchema,
  overviewQuerySchema,
  overviewSchema,
  pendingTriageSchema,
  postMessageSchema,
  replyDraftSchema,
  statusSchema,
  summarySchema,
  ticketParams,
  ticketProposalSchema,
  triageInsightSchema,
} from '../contracts';
import { formatSse } from '../lib/sse';
import { aiInfo, AssistService, readSettings, toTriageDto } from './assist';
import { ChatService } from './chat';
import { overview, pendingTriage, requireMetrics } from './insights';

const idParams = z.object({ id: z.uuid() });
const ASSIST = 'helpdesk-ai.assist.use';
const CHAT = 'helpdesk-ai.chat.use';
const HEARTBEAT_MS = 15_000;

/** REST API mounted at /api/v1/helpdesk-ai. */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const assist = new AssistService(ctx);
  const chat = new ChatService(ctx);

  /* ───────────────────────────── assist ───────────────────────────── */

  const tags = ['Helpdesk AI · assist'];

  app.get(
    '/tickets/:ticketId/assist',
    {
      config: { permission: ASSIST },
      schema: {
        tags,
        summary: 'AI assist panel: mode, triage suggestion, similar resolved tickets and suggested articles',
        params: ticketParams,
        response: { 200: assistSchema },
      },
    },
    async (req) => assist.assist(req.params.ticketId, req.auth),
  );

  app.post(
    '/tickets/:ticketId/triage',
    {
      config: { permission: ASSIST },
      schema: {
        tags,
        summary: 'Re-run triage for a ticket (as the caller; never applies anything)',
        params: ticketParams,
        response: { 200: triageInsightSchema },
      },
    },
    async (req) => {
      const row = await assist.triage(req.params.ticketId, { auth: req.auth, trigger: 'manual' });
      return toTriageDto(row!);
    },
  );

  app.post(
    '/tickets/:ticketId/reply-draft',
    {
      config: { permission: ASSIST },
      schema: {
        tags,
        summary: "Draft a reply in the requester's language, grounded in knowledge-base articles",
        params: ticketParams,
        response: { 200: replyDraftSchema },
      },
    },
    async (req) => assist.replyDraft(req.params.ticketId, req.auth),
  );

  app.post(
    '/tickets/:ticketId/summary',
    {
      config: { permission: ASSIST },
      schema: {
        tags,
        summary: 'Summarise a ticket (cached until the ticket changes)',
        params: ticketParams,
        response: { 200: summarySchema },
      },
    },
    async (req) => assist.summary(req.params.ticketId, req.auth),
  );

  app.post(
    '/tickets/:ticketId/kb-draft',
    {
      config: { permission: ASSIST },
      schema: {
        tags,
        summary:
          'Create a knowledge-base draft (Symptoms / Cause / Resolution / Applies to) from a resolved ticket',
        params: ticketParams,
        response: { 200: kbDraftSchema },
      },
    },
    async (req) => assist.kbDraft(req.params.ticketId, req.auth),
  );

  app.post(
    '/insights/:id/feedback',
    {
      config: { permission: ASSIST },
      schema: {
        tags,
        summary: 'Record what the agent did with a triage suggestion',
        params: idParams,
        body: insightFeedbackSchema,
        response: { 200: triageInsightSchema },
      },
    },
    async (req) => assist.feedback(req.params.id, req.body, req.auth),
  );

  /* ───────────────────────────── virtual agent ───────────────────────────── */

  const chatTags = ['Helpdesk AI · virtual agent'];

  app.get(
    '/status',
    {
      config: { permission: CHAT },
      schema: {
        tags: chatTags,
        summary: 'Virtual agent availability and mode',
        response: { 200: statusSchema },
      },
    },
    async () => {
      const [ai, settings, status] = await Promise.all([aiInfo(ctx), readSettings(ctx), ctx.ai.status()]);
      return {
        ai,
        virtualAgentEnabled: settings.virtualAgentEnabled,
        images: !!(status.images?.chat || status.images?.describe),
      };
    },
  );

  app.post(
    '/conversations',
    {
      config: { permission: CHAT },
      schema: {
        tags: chatTags,
        summary: 'Start a conversation with the virtual agent',
        body: createConversationSchema,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => reply.status(201).send(await chat.create(req.auth, req.body.locale)),
  );

  app.get(
    '/conversations',
    {
      // `scope=all` additionally needs helpdesk-ai.insights.read (checked in the service).
      config: { permission: CHAT, scoped: true },
      schema: {
        tags: chatTags,
        summary: 'My conversations (or all of them, for review)',
        querystring: conversationQuerySchema,
        response: { 200: pageSchema(conversationSchema) },
      },
    },
    async (req) => chat.list(req.query, req.auth),
  );

  app.get(
    '/conversations/:id',
    {
      config: { permission: CHAT, scoped: true },
      schema: {
        tags: chatTags,
        summary: 'A conversation with its messages (own, or any for insights reviewers)',
        params: idParams,
        response: { 200: conversationDetailSchema },
      },
    },
    async (req) => chat.get(req.params.id, req.auth),
  );

  app.post(
    '/conversations/:id/messages',
    {
      config: { permission: CHAT },
      schema: {
        tags: chatTags,
        summary: 'Ask the virtual agent (answer streamed as text/event-stream)',
        description:
          'Events: `delta {text}`, `tool {name}`, `citations {items}`, `proposal {title, description, urgency, type}`, `done {messageId, mode, model}`, `error {code}`.',
        params: idParams,
        body: postMessageSchema,
      },
    },
    async (req, reply) => {
      const turn = await chat.prepareTurn(req.params.id, req.body.content, req.auth, req.body.images);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const open = () => !res.writableEnded && !res.destroyed;
      // Keeps proxies from closing the connection while the model thinks.
      const heartbeat = setInterval(() => open() && res.write(': ping\n\n'), HEARTBEAT_MS);
      try {
        // The answer is generated and stored even if the client goes away mid-stream.
        for await (const evt of chat.streamTurn(turn)) {
          if (open()) res.write(formatSse(evt.event, evt.data));
        }
      } catch (err) {
        req.log.error({ err }, 'virtual agent stream failed');
        if (open()) res.write(formatSse('error', { code: 'INTERNAL' }));
      } finally {
        clearInterval(heartbeat);
        if (open()) res.end();
      }
    },
  );

  app.post(
    '/conversations/:id/resolve',
    {
      config: { permission: CHAT },
      schema: {
        tags: chatTags,
        summary: '"That solved it": close the conversation as deflected',
        params: idParams,
        response: { 200: conversationSchema },
      },
    },
    async (req) => chat.resolve(req.params.id, req.auth),
  );

  app.post(
    '/conversations/:id/escalate',
    {
      config: { permission: CHAT },
      schema: {
        tags: chatTags,
        summary: 'Confirm the proposed ticket: raises it as the user (channel chat) and links it',
        params: idParams,
        body: ticketProposalSchema,
        response: { 200: escalateResultSchema },
      },
    },
    async (req) => chat.escalate(req.params.id, req.body, req.auth),
  );

  /* ───────────────────────────── insights ───────────────────────────── */

  // Metrics are for Helpdesk AI's reviewers and for service desk report readers (`itsm.reports.read`, read-only):
  // a route can require only one permission, so it asks for one everyone has and the handler checks either.
  const metrics = { permission: CHAT, scoped: true } as const;
  const insightTags = ['Helpdesk AI · insights'];

  app.get(
    '/insights/overview',
    {
      config: metrics,
      schema: {
        tags: insightTags,
        summary: 'Triage acceptance, deflection, KB drafts and AI cost over a period',
        description: 'Needs `helpdesk-ai.insights.read` or `itsm.reports.read`.',
        querystring: overviewQuerySchema,
        response: { 200: overviewSchema },
      },
    },
    async (req) => {
      requireMetrics(req.auth);
      return overview(ctx, req.query.days, req.auth);
    },
  );

  app.get(
    '/insights/pending',
    {
      config: metrics,
      schema: {
        tags: insightTags,
        summary: 'Triage suggestions still waiting for an agent on open tickets, newest first',
        description: 'Needs `helpdesk-ai.insights.read` or `itsm.reports.read`.',
        querystring: overviewQuerySchema,
        response: { 200: pendingTriageSchema },
      },
    },
    async (req) => {
      requireMetrics(req.auth);
      return pendingTriage(ctx, req.query.days, req.auth);
    },
  );
}
