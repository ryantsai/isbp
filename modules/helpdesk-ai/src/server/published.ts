import { createHash, randomBytes } from 'node:crypto';
import { categories } from '@isbp/module-knowledge/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  PermissionSet,
} from '@isbp/sdk/server';
import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Out, PublishedChatInput } from '../contracts';
import { aiInfo, readSettings } from './assist';
import type { ChatPolicy, Seat } from './chat';
import { conversations, type PublishedChatRow, publishedChats } from './schema';

/** A published chat's session as stored (by the hash of its token) in the module's cache. */
interface StoredSession {
  chatId: string;
  userId: string | null;
  visitorId: string | null;
  expiresAt: string;
}

/** Questions per minute one session may ask (on top of the platform's per-IP limit). */
export const SESSION_QUESTIONS_PER_MINUTE = 10;

const newToken = () => randomBytes(24).toString('base64url');
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const sessionKey = (token: string) => `chat-session:${hash(token)}`;

const CHAT_FIELDS = [
  'name',
  'enabled',
  'access',
  'allowedOrigins',
  'categoryIds',
  'title',
  'welcome',
  'sessionMinutes',
] as const;

/**
 * Ask IT published outside the platform (§16.6): administrators publish a chat link and an embeddable widget;
 * people use it signed in (with their own permissions) or, when published for anyone, as visitors who can read
 * the public articles of the chosen categories and raise no tickets.
 */
export class PublishedChatService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────────────────────── administration ───────────────────────────── */

  async list(): Promise<Out['PublishedChat'][]> {
    const rows = await this.ctx.db.select().from(publishedChats).orderBy(asc(publishedChats.name));
    const counts = await this.conversationCounts(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, counts.get(r.id) ?? 0));
  }

  async get(id: string): Promise<Out['PublishedChat']> {
    const row = await this.row(id);
    return this.toDto(row, (await this.conversationCounts([id])).get(id) ?? 0);
  }

  async create(
    input: Partial<PublishedChatInput> & Pick<PublishedChatInput, 'name' | 'access'>,
    auth: AuthContext,
  ) {
    const values = await this.checked(input);
    const row = await this.ctx.transaction(async (tx) => {
      const [created] = await tx
        .insert(publishedChats)
        .values({
          ...values,
          name: input.name,
          access: input.access,
          token: newToken(),
          createdBy: auth.user?.id ?? null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'helpdesk-ai.published_chat.created',
          entityType: 'helpdesk-ai.published_chat',
          entityId: created!.id,
          entityLabel: created!.name,
          metadata: { access: created!.access, allowedOrigins: created!.allowedOrigins },
        },
        { tx },
      );
      return created!;
    });
    return this.toDto(row, 0);
  }

  async update(id: string, input: Partial<PublishedChatInput>) {
    const before = await this.row(id);
    const values = await this.checked(input);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(publishedChats)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(publishedChats.id, id));
      await this.ctx.audit.record(
        {
          action: 'helpdesk-ai.published_chat.updated',
          entityType: 'helpdesk-ai.published_chat',
          entityId: id,
          entityLabel: values.name ?? before.name,
          changes: this.ctx.audit.diff(before, values, [...CHAT_FIELDS]),
        },
        { tx },
      );
    });
    return this.get(id);
  }

  /** A new link: the old one, the old embeds and every session stop working. */
  async regenerate(id: string) {
    const before = await this.row(id);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(publishedChats)
        .set({ token: newToken(), updatedAt: new Date() })
        .where(eq(publishedChats.id, id));
      await this.ctx.audit.record(
        {
          action: 'helpdesk-ai.published_chat.link_regenerated',
          entityType: 'helpdesk-ai.published_chat',
          entityId: id,
          entityLabel: before.name,
          category: 'security',
        },
        { tx },
      );
    });
    return this.get(id);
  }

  /** Its conversations stay (for the insights), no longer linked to a chat. */
  async remove(id: string) {
    const before = await this.row(id);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(publishedChats).where(eq(publishedChats.id, id));
      await this.ctx.audit.record(
        {
          action: 'helpdesk-ai.published_chat.deleted',
          entityType: 'helpdesk-ai.published_chat',
          entityId: id,
          entityLabel: before.name,
        },
        { tx },
      );
    });
  }

  /** Knowledge categories to choose from (this module may read the knowledge base's tables). */
  async categories() {
    return this.ctx.db
      .select({ id: categories.id, key: categories.key, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.key));
  }

  /* ───────────────────────────── the public side ───────────────────────────── */

  /** An enabled chat by its link token; 404 for anything else (unknown, disabled, or the virtual agent off). */
  async byToken(token: string): Promise<PublishedChatRow> {
    const [row] = /^[A-Za-z0-9_-]{16,64}$/.test(token)
      ? await this.ctx.db.select().from(publishedChats).where(eq(publishedChats.token, token))
      : [];
    if (!row?.enabled || !(await readSettings(this.ctx)).virtualAgentEnabled)
      throw httpErrors.notFound('Chat not found');
    return row;
  }

  async info(token: string): Promise<Out['PublicChat']> {
    const chat = await this.byToken(token);
    const ai = await aiInfo(this.ctx);
    return {
      title: chat.title,
      welcome: chat.welcome,
      access: chat.access,
      mode: ai.mode,
      tickets: chat.access === 'signed_in',
    };
  }

  /**
   * Websites that may show the chat in a frame (the web proxy's `frame-ancestors`): its allowed origins, or none.
   * Unknown and disabled chats may be framed by no one.
   */
  async frameAncestors(token: string): Promise<string[]> {
    try {
      return (await this.byToken(token)).allowedOrigins;
    } catch {
      return [];
    }
  }

  /**
   * Starts a session. A chat for signed-in people needs the platform's session cookie (a link, or the sign-in
   * window an embedded chat opens); a chat for anyone gives the visitor a session of their own.
   */
  async startSession(token: string, auth: AuthContext | null): Promise<Out['ChatSession']> {
    const chat = await this.byToken(token);
    let userId: string | null = null;
    if (chat.access === 'signed_in') {
      if (!auth?.user)
        throw new HttpError(401, ErrorCodes.UNAUTHENTICATED, 'Sign in to use this chat', {
          reason: 'sign_in',
        });
      auth.require('helpdesk-ai.chat.use');
      userId = auth.user.id;
    }
    const session = newToken();
    const expiresAt = new Date(Date.now() + chat.sessionMinutes * 60_000);
    const stored: StoredSession = {
      chatId: chat.id,
      userId,
      visitorId: userId ? null : `v_${randomBytes(12).toString('base64url')}`,
      expiresAt: expiresAt.toISOString(),
    };
    await this.ctx.cache.set(sessionKey(session), stored, chat.sessionMinutes * 60);
    return { session, expiresAt, user: auth?.user ? { displayName: auth.user.displayName } : null };
  }

  /**
   * The caller of a chat's conversation routes: the session's person (with their own permissions) or visitor
   * (public articles only), and where their conversations are held. 401 when the session is missing or over.
   */
  async caller(
    token: string,
    session: string | undefined,
    opts: { question?: boolean } = {},
  ): Promise<{ auth: AuthContext; seat: Seat }> {
    const chat = await this.byToken(token);
    const stored = session ? await this.ctx.cache.get<StoredSession>(sessionKey(session)) : null;
    if (!stored || stored.chatId !== chat.id || new Date(stored.expiresAt).getTime() <= Date.now())
      throw new HttpError(401, ErrorCodes.UNAUTHENTICATED, 'The chat session has ended', {
        reason: 'session_expired',
      });
    // Questions are limited per session (the platform also limits each address).
    const limit = opts.question
      ? await this.ctx.cache.rateLimit(`chat-questions:${hash(session!)}`, SESSION_QUESTIONS_PER_MINUTE, 60)
      : null;
    if (limit && !limit.allowed)
      throw new HttpError(429, ErrorCodes.RATE_LIMITED, 'Too many questions: wait a moment', {
        retryAfterSeconds: limit.resetSeconds,
      });
    const policy: ChatPolicy =
      chat.access === 'signed_in'
        ? { tickets: true, categoryIds: [], visitor: false }
        : { tickets: false, categoryIds: chat.categoryIds, visitor: true };
    const seat: Seat = { channelId: chat.id, visitorId: stored.visitorId, policy };
    if (stored.userId) {
      const auth = await this.ctx.rbac.authFor(stored.userId);
      // Deactivated since, or no longer allowed to use the virtual agent.
      if (!auth?.can('helpdesk-ai.chat.use'))
        throw new HttpError(401, ErrorCodes.UNAUTHENTICATED, 'Sign in again', { reason: 'sign_in' });
      return { auth, seat };
    }
    return { auth: visitorAuth(chat.name), seat };
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  private async row(id: string): Promise<PublishedChatRow> {
    const [row] = await this.ctx.db.select().from(publishedChats).where(eq(publishedChats.id, id));
    if (!row) throw httpErrors.notFound('Published chat not found');
    return row;
  }

  /** The fields to store, with origins de-duplicated and categories that exist. */
  private async checked(input: Partial<PublishedChatInput>) {
    const values: Partial<typeof publishedChats.$inferInsert> = {};
    for (const key of CHAT_FIELDS) if (input[key] !== undefined) Object.assign(values, { [key]: input[key] });
    if (input.allowedOrigins) values.allowedOrigins = [...new Set(input.allowedOrigins)];
    if (input.categoryIds?.length) {
      const ids = [...new Set(input.categoryIds)];
      const found = await this.ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, ids));
      if (found.length !== ids.length)
        throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Unknown knowledge category', {
          issues: [{ path: 'categoryIds', message: 'unknown category' }],
        });
      values.categoryIds = ids;
    }
    return values;
  }

  private async conversationCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.ctx.db
      .select({ id: conversations.channelId, n: count() })
      .from(conversations)
      .where(and(isNotNull(conversations.channelId), inArray(conversations.channelId, ids)))
      .groupBy(conversations.channelId);
    return new Map(rows.map((r) => [r.id!, r.n]));
  }

  private toDto(r: PublishedChatRow, conversationCount: number): Out['PublishedChat'] {
    return {
      id: r.id,
      name: r.name,
      token: r.token,
      enabled: r.enabled,
      access: r.access,
      allowedOrigins: r.allowedOrigins,
      categoryIds: r.categoryIds,
      title: r.title,
      welcome: r.welcome,
      sessionMinutes: r.sessionMinutes,
      conversations: conversationCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

/** A visitor of a chat published for anyone: reads public articles, nothing else. */
function visitorAuth(chatName: string): AuthContext {
  const permissions = new PermissionSet([{ p: 'knowledge.articles.read', s: 'g' }]);
  return {
    principal: { type: 'service', id: null, name: `Visitor (${chatName})` },
    user: null,
    sessionId: null,
    permissions,
    can: (permission, resource) => permissions.can(permission, resource),
    require(permission, resource) {
      if (!permissions.can(permission, resource)) throw httpErrors.forbidden();
    },
    reach: (permission) => permissions.reach(permission),
  };
}
