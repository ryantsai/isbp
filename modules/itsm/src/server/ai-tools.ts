/**
 * Handlers of the manifest's AI tools (contract: the `ai*` schemas in contracts.ts). They enforce the
 * same scope rules as the routes, with the caller's `auth`, through the same service methods.
 */
import { type AiToolHandler, type AuthContext, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, desc, eq, ilike, inArray, notInArray, or, type SQL } from 'drizzle-orm';
import {
  type AiCommentResult,
  type AiTicket,
  type AiTicketList,
  type AiTriageResult,
  aiAddCommentInput,
  aiCreateTicketInput,
  aiFindTicketsInput,
  aiMyTicketsInput,
  aiResolveTicketInput,
  aiTicketRef,
  aiTriageTicketInput,
  DONE_STATUSES,
  parseTicketRef,
} from '../contracts';
import { canReadAsAgent, visibilityFilter } from './access';
import type { TicketRow } from './dto';
import { categoryMap, groupsByIds, peopleByIds } from './lookups';
import { refOf, ticketHref } from './rules';
import { ticketActivities, tickets } from './schema';
import { services } from './services';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function aiTicket(ctx: ModuleContext, t: TicketRow, auth: AuthContext): Promise<AiTicket> {
  const { tickets: svc } = services(ctx);
  const agent = canReadAsAgent(t, auth);
  const [people, groupMap, cats, ciList, acts] = await Promise.all([
    peopleByIds(ctx.db, [t.requesterId, t.assigneeId]),
    groupsByIds(ctx.db, [t.assignmentGroupId]),
    categoryMap(ctx.db),
    svc.reader.cisOf(t.id),
    ctx.db
      .select()
      .from(ticketActivities)
      .where(
        and(
          eq(ticketActivities.ticketId, t.id),
          inArray(ticketActivities.kind, ['comment', 'work_note', 'status', 'triage']),
          agent ? undefined : eq(ticketActivities.public, true),
        ),
      )
      .orderBy(desc(ticketActivities.createdAt))
      .limit(30),
  ]);
  const authors = await peopleByIds(
    ctx.db,
    acts.map((a) => a.authorId),
  );
  const requester = t.requesterId ? people.get(t.requesterId) : undefined;
  const assignee = t.assigneeId ? people.get(t.assigneeId) : undefined;
  const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
  const reference = refOf(t);
  return {
    id: t.id,
    reference,
    type: t.type,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    impact: t.impact,
    urgency: t.urgency,
    category: cat ? { id: cat.id, key: cat.key, path: cat.path } : null,
    assignmentGroup: (t.assignmentGroupId && groupMap.get(t.assignmentGroupId)) || null,
    assignee: assignee ? { id: assignee.id, displayName: assignee.displayName } : null,
    requester: requester
      ? { id: requester.id, displayName: requester.displayName, locale: requester.locale }
      : null,
    cis: ciList.map((c) => ({ id: c.id, name: c.name })),
    resolutionCode: t.resolutionCode,
    resolutionNotes: t.resolutionNotes,
    href: ticketHref(reference),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: iso(t.resolvedAt),
    activities: acts.reverse().map((a) => ({
      kind: a.kind,
      public: a.public,
      author: (a.authorId ? authors.get(a.authorId)?.displayName : a.authorName) ?? null,
      body:
        a.kind === 'status'
          ? `${String(a.data.from)} → ${String(a.data.to)}${a.body ? `: ${a.body}` : ''}`
          : a.body,
      at: a.createdAt.toISOString(),
    })),
  };
}

async function summaries(ctx: ModuleContext, rows: TicketRow[]): Promise<AiTicketList['items']> {
  const people = await peopleByIds(
    ctx.db,
    rows.flatMap((t) => [t.requesterId, t.assigneeId]),
  );
  return rows.map((t) => {
    const reference = refOf(t);
    return {
      id: t.id,
      reference,
      type: t.type,
      title: t.title,
      status: t.status,
      priority: t.priority,
      requester: (t.requesterId && people.get(t.requesterId)?.displayName) || null,
      assignee: (t.assigneeId && people.get(t.assigneeId)?.displayName) || null,
      updatedAt: t.updatedAt.toISOString(),
      resolutionNotes: t.resolutionNotes,
      href: ticketHref(reference),
    };
  });
}

const statusCond = (status: 'open' | 'done' | 'all'): SQL | undefined =>
  status === 'open'
    ? notInArray(tickets.status, [...DONE_STATUSES])
    : status === 'done'
      ? inArray(tickets.status, [...DONE_STATUSES])
      : undefined;

export const aiTools: Record<string, AiToolHandler> = {
  'itsm.find_tickets': async (raw, ctx, auth) => {
    const input = aiFindTicketsInput.parse(raw);
    const words = (input.query ?? '')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1)
      .slice(0, 8);
    const ref = input.query ? parseTicketRef(input.query) : null;
    const text = words.length
      ? and(
          ...words.map((w) =>
            or(ilike(tickets.title, likePattern(w)), ilike(tickets.description, likePattern(w))),
          ),
        )
      : undefined;
    const rows = await ctx.db
      .select()
      .from(tickets)
      .where(
        and(
          visibilityFilter(auth),
          ref ? and(eq(tickets.type, ref.type), eq(tickets.number, ref.number)) : text,
          ref ? undefined : statusCond(input.status),
          input.type ? eq(tickets.type, input.type) : undefined,
        ),
      )
      .orderBy(desc(tickets.updatedAt))
      .limit(input.limit);
    return { items: await summaries(ctx, rows) };
  },

  'itsm.get_ticket': async (raw, ctx, auth) => {
    const input = aiTicketRef.parse(raw);
    const t = await services(ctx).tickets.visibleRow((input.id ?? input.reference)!, auth);
    return aiTicket(ctx, t, auth);
  },

  'itsm.my_tickets': async (raw, ctx, auth) => {
    const input = aiMyTicketsInput.parse(raw);
    const me = auth.user?.id;
    if (!me) return { items: [] };
    const rows = await ctx.db
      .select()
      .from(tickets)
      .where(and(or(eq(tickets.requesterId, me), eq(tickets.requestedForId, me)), statusCond(input.status)))
      .orderBy(desc(tickets.updatedAt))
      .limit(input.limit);
    return { items: await summaries(ctx, rows) };
  },

  'itsm.create_ticket': async (raw, ctx, auth) => {
    const input = aiCreateTicketInput.parse(raw);
    const { tickets: svc } = services(ctx);
    const row = await svc.create(
      {
        type: input.type,
        title: input.title,
        description: input.description,
        urgency: input.urgency,
        categoryId: input.categoryId,
        ciIds: input.ciIds ?? [],
      },
      auth,
      { channel: input.channel },
    );
    return aiTicket(ctx, row, auth);
  },

  'itsm.add_comment': async (raw, ctx, auth) => {
    const input = aiAddCommentInput.parse(raw);
    const { tickets: svc } = services(ctx);
    const activity = await svc.comment(input.ticketId, { body: input.body, public: input.public }, auth);
    const t = await svc.visibleRow(input.ticketId, auth);
    const result: AiCommentResult = {
      id: activity.id,
      ticketId: t.id,
      reference: refOf(t),
      public: activity.public,
      createdAt: activity.createdAt.toISOString(),
    };
    return result;
  },

  'itsm.get_triage_options': async (_raw, ctx) => services(ctx).config.triageOptions(),

  'itsm.triage_ticket': async (raw, ctx, auth) => {
    const input = aiTriageTicketInput.parse(raw);
    const { row, applied, skipped } = await services(ctx).tickets.triage(input, auth);
    const result: AiTriageResult = { applied, skipped, ticket: await aiTicket(ctx, row, auth) };
    return result;
  },

  'itsm.resolve_ticket': async (raw, ctx, auth) => {
    const input = aiResolveTicketInput.parse(raw);
    const { tickets: svc } = services(ctx);
    const t = await svc.visibleRow(input.ticketId, auth);
    const row = await svc.transition(
      t.id,
      {
        status: t.type === 'service_request' ? 'fulfilled' : 'resolved',
        resolutionCode: input.resolutionCode,
        resolutionNotes: input.resolutionNotes,
      },
      auth,
    );
    return aiTicket(ctx, row, auth);
  },
};
