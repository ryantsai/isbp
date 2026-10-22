import {
  type AuthContext,
  likePattern,
  type ModuleContext,
  type RecordResolver,
  type RecordSummary,
  type StatusTone,
} from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { ConversationStatus } from '../contracts';
import { type ConversationRow, conversations } from './schema';

const TONE: Record<ConversationStatus, StatusTone> = {
  open: 'info',
  resolved: 'success',
  escalated: 'neutral',
};

/** Owners see their conversations; conversation reviewers (insights) see all of them. Only owners add files. */
function visible(auth: AuthContext): SQL | undefined {
  if (auth.can('helpdesk-ai.insights.read')) return undefined;
  // API clients have no conversations.
  return auth.user ? eq(conversations.userId, auth.user.id) : sql`false`;
}

function toRecord(c: ConversationRow, auth: AuthContext): RecordSummary {
  return {
    id: c.id,
    title: c.title || c.id.slice(0, 8),
    status: { key: `helpdesk-ai.conversationStatus.${c.status}`, tone: TONE[c.status] },
    href: `/helpdesk-ai/chat?c=${c.id}`,
    editable: !!auth.user && c.userId === auth.user.id,
  };
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Ask IS conversations as records: screenshots attached to a question are files on its conversation. */
export const conversationRecords: RecordResolver = {
  async resolve(ids, ctx: ModuleContext, auth) {
    const valid = ids.filter((id) => UUID.test(id));
    if (!valid.length) return [];
    const rows = await ctx.db
      .select()
      .from(conversations)
      .where(and(inArray(conversations.id, valid), visible(auth)));
    return rows.map((c) => toRecord(c, auth));
  },
  async search(query, ctx, auth, limit) {
    const q = query.trim();
    const rows = await ctx.db
      .select()
      .from(conversations)
      .where(
        and(
          visible(auth),
          q
            ? or(
                ilike(conversations.title, likePattern(q)),
                UUID.test(q) ? eq(conversations.id, q) : undefined,
              )
            : undefined,
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map((c) => toRecord(c, auth));
  },
};
