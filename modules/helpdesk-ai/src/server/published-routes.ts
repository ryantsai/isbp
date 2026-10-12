import { httpErrors, type ModuleContext, type ModuleRouter } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  CHAT_SESSION_HEADER,
  chatSessionSchema,
  conversationDetailSchema,
  conversationSchema,
  createConversationSchema,
  createPublishedChatSchema,
  publishCategorySchema,
  escalateResultSchema,
  postMessageSchema,
  publicChatSchema,
  publishedArticleSchema,
  publishedChatSchema,
  ticketProposalSchema,
  updatePublishedChatSchema,
} from '../contracts';
import type { ChatService } from './chat';
import { EMBED_SCRIPT } from './embed-script';
import { PublishedChatService } from './published';
import { streamAnswer } from './routes';
import { Tools } from './tools';

const MANAGE = 'helpdesk-ai.publish.manage';
const CHAT = 'helpdesk-ai.chat.use';
const idParams = z.object({ id: z.uuid() });
const tokenParams = z.object({ token: z.string().max(64) });
const conversationParams = z.object({ token: z.string().max(64), id: z.uuid() });
/** Public routes: no sign-in, no CSRF (they take no cookie-authenticated action), limited per address. */
const open = (max: number) =>
  ({ public: true, csrf: false, rateLimit: { max, timeWindow: '1 minute' } }) as const;

/**
 * Ask IT published outside the platform (§16.6): administration under `/published-chats`, and the chat itself
 * under `/published/:token` (public; each conversation route takes the session from `x-isbp-chat-session`).
 */
export function publishedRoutes(app: ModuleRouter, ctx: ModuleContext, chat: ChatService) {
  const published = new PublishedChatService(ctx);
  const tools = new Tools(ctx);
  const sessionOf = (headers: Record<string, unknown>) => {
    const v = headers[CHAT_SESSION_HEADER];
    return typeof v === 'string' ? v : undefined;
  };

  /* ───────────────────────────── administration ───────────────────────────── */

  const adminTags = ['Helpdesk AI · published chats'];

  app.get(
    '/published-chats',
    {
      config: { permission: MANAGE },
      schema: {
        tags: adminTags,
        summary: 'Published chats (links and embeds of Ask IT)',
        response: { 200: z.object({ items: z.array(publishedChatSchema) }) },
      },
    },
    async () => ({ items: await published.list() }),
  );

  app.get(
    '/published-chats/categories',
    {
      config: { permission: MANAGE },
      schema: {
        tags: adminTags,
        summary: 'Knowledge categories a chat published for anyone may answer from',
        response: { 200: z.object({ items: z.array(publishCategorySchema) }) },
      },
    },
    async () => ({ items: await published.categories() }),
  );

  app.post(
    '/published-chats',
    {
      config: { permission: MANAGE },
      schema: {
        tags: adminTags,
        summary: 'Publish Ask IT: a new chat link and embed',
        body: createPublishedChatSchema,
        response: { 201: publishedChatSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await published.create(req.body, req.auth)),
  );

  app.get(
    '/published-chats/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: adminTags,
        summary: 'A published chat',
        params: idParams,
        response: { 200: publishedChatSchema },
      },
    },
    async (req) => published.get(req.params.id),
  );

  app.patch(
    '/published-chats/:id',
    {
      config: { permission: MANAGE },
      schema: {
        tags: adminTags,
        summary: 'Change a published chat (who may use it, websites, categories, text, on/off)',
        params: idParams,
        body: updatePublishedChatSchema,
        response: { 200: publishedChatSchema },
      },
    },
    async (req) => published.update(req.params.id, req.body),
  );

  app.post(
    '/published-chats/:id/regenerate',
    {
      config: { permission: MANAGE },
      schema: {
        tags: adminTags,
        summary: 'A new link: the old link, embeds and sessions stop working',
        params: idParams,
        response: { 200: publishedChatSchema },
      },
    },
    async (req) => published.regenerate(req.params.id),
  );

  app.delete(
    '/published-chats/:id',
    {
      config: { permission: MANAGE },
      schema: { tags: adminTags, summary: 'Unpublish and delete a chat', params: idParams },
    },
    async (req, reply) => {
      await published.remove(req.params.id);
      return reply.status(204).send();
    },
  );

  /* ───────────────────────────── the chat ───────────────────────────── */

  const tags = ['Helpdesk AI · published chat'];

  app.get(
    '/published/embed.js',
    {
      config: open(600),
      schema: { tags, summary: 'The chat bubble script other websites load (`data-chat` = the link token)' },
    },
    async (_req, reply) =>
      reply
        .header('content-type', 'text/javascript; charset=utf-8')
        // Loaded by other websites' pages.
        .header('cross-origin-resource-policy', 'cross-origin')
        .header('cache-control', 'public, max-age=300')
        .send(EMBED_SCRIPT),
  );

  app.get(
    '/published/:token',
    {
      config: open(120),
      schema: {
        tags,
        summary: 'What the chat shows before the conversation (title, greeting, who may use it, mode)',
        params: tokenParams,
        response: { 200: publicChatSchema },
      },
    },
    async (req) => published.info(req.params.token),
  );

  app.post(
    '/published/:token/sessions',
    {
      config: open(20),
      schema: {
        tags,
        summary: 'A visitor session (chats published for anyone)',
        description:
          'Chats for signed-in people answer 401 `UNAUTHENTICATED` (`reason: sign_in`): use `/sessions/me`.',
        params: tokenParams,
        response: { 201: chatSessionSchema },
      },
    },
    // A signed-in session needs the CSRF-checked route below, never this public one: no person here.
    async (req, reply) => reply.status(201).send(await published.startSession(req.params.token, null)),
  );

  app.post(
    '/published/:token/sessions/me',
    {
      config: { permission: CHAT, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary:
          'A session for the signed-in person (chats for signed-in people; the sign-in window asks for it)',
        params: tokenParams,
        response: { 201: chatSessionSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await published.startSession(req.params.token, req.auth)),
  );

  app.post(
    '/published/:token/conversations',
    {
      config: open(30),
      schema: {
        tags,
        summary: 'Start a conversation in the chat (session header)',
        params: tokenParams,
        body: createConversationSchema,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const { auth, seat } = await published.caller(req.params.token, sessionOf(req.headers));
      return reply.status(201).send(await chat.create(auth, req.body.locale, seat));
    },
  );

  app.get(
    '/published/:token/conversations/:id',
    {
      config: open(120),
      schema: {
        tags,
        summary: 'A conversation of this session (session header)',
        params: conversationParams,
        response: { 200: conversationDetailSchema },
      },
    },
    async (req) => {
      const { auth, seat } = await published.caller(req.params.token, sessionOf(req.headers));
      return chat.get(req.params.id, auth, seat);
    },
  );

  app.post(
    '/published/:token/conversations/:id/messages',
    {
      config: open(30),
      schema: {
        tags,
        summary: 'Ask (answer streamed as text/event-stream, like the platform chat; session header)',
        params: conversationParams,
        body: postMessageSchema,
      },
    },
    async (req, reply) => {
      const { auth, seat } = await published.caller(req.params.token, sessionOf(req.headers), {
        question: true,
      });
      const turn = await chat.prepareTurn(req.params.id, req.body.content, auth, req.body.images, seat);
      await streamAnswer(chat, turn, reply, req.log);
    },
  );

  app.get(
    '/published/:token/articles/:id',
    {
      config: open(60),
      schema: {
        tags,
        summary:
          "An article the chat cited, to read in the chat (only the chat's categories; session header)",
        params: conversationParams,
        response: { 200: publishedArticleSchema },
      },
    },
    async (req) => {
      const { auth, seat } = await published.caller(req.params.token, sessionOf(req.headers));
      // Read with the caller's own permissions: a visitor reads public articles only.
      const article = await tools.article(auth, { id: req.params.id });
      const { categoryIds } = seat.policy;
      if (!article || (categoryIds.length && !categoryIds.includes(article.category?.id ?? '')))
        throw httpErrors.notFound('Article not found');
      const { id, reference, title, summary, body, updatedAt } = article;
      return { id, reference, title, summary, body, updatedAt };
    },
  );

  app.post(
    '/published/:token/conversations/:id/resolve',
    {
      config: open(30),
      schema: {
        tags,
        summary: '"That solved it" (session header)',
        params: conversationParams,
        response: { 200: conversationSchema },
      },
    },
    async (req) => {
      const { auth, seat } = await published.caller(req.params.token, sessionOf(req.headers));
      return chat.resolve(req.params.id, auth, seat);
    },
  );

  app.post(
    '/published/:token/conversations/:id/escalate',
    {
      config: open(10),
      schema: {
        tags,
        summary:
          'Raise the proposed ticket as the signed-in person (chats for signed-in people; session header)',
        params: conversationParams,
        body: ticketProposalSchema,
        response: { 200: escalateResultSchema },
      },
    },
    async (req) => {
      const { auth, seat } = await published.caller(req.params.token, sessionOf(req.headers));
      return chat.escalate(req.params.id, req.body, auth, seat);
    },
  );
}
