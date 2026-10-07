import { users } from '@isbp/db/schema';
import type { AuthContext, ModuleContext, SessionUser } from '@isbp/sdk/server';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import type { ChatLocale, Citation, TriageData, TriageField } from '../contracts';
import { CitationRegistry, RELEVANCE, relevantHits, teaser } from '../lib/citations';
import { normalizeLocale } from '../lib/language';
import { AssistService, TRIAGE_TYPES } from './assist';
import { builtinAnswer, builtinProposal } from './chat';
import { conversations, insights, messages } from './schema';
import { texts } from './text';
import { itemsOf } from './tools';

type Outcome = 'deflected' | 'escalated' | 'open';

interface Scenario {
  locale: ChatLocale;
  outcome: Outcome;
  daysAgo: number;
  /** User turns (a second one is a follow-up). */
  turns: string[];
  /** Finds the seeded ticket an escalated conversation links to. */
  ticketQuery?: string;
}

const SCENARIOS: Scenario[] = [
  {
    locale: 'en',
    outcome: 'deflected',
    daysAgo: 11,
    turns: ['My VPN keeps disconnecting every few minutes when I work from home'],
  },
  {
    locale: 'zh-TW',
    outcome: 'deflected',
    daysAgo: 9,
    turns: ['Outlook 一直跳出視窗要我重新輸入密碼，該怎麼處理？'],
  },
  {
    locale: 'ja-JP',
    outcome: 'deflected',
    daysAgo: 7,
    turns: ['新しいスマートフォンで多要素認証 (MFA) を設定するにはどうすればいいですか？'],
  },
  {
    locale: 'en',
    outcome: 'escalated',
    daysAgo: 6,
    turns: [
      'My laptop screen flickers and went completely black twice this morning',
      'I already updated the display driver and restarted, it still happens',
    ],
    ticketQuery: 'laptop',
  },
  {
    locale: 'zh-TW',
    outcome: 'escalated',
    daysAgo: 4,
    turns: ['我需要申請 VPN 的存取權限，下週開始要在家工作'],
    ticketQuery: 'VPN',
  },
  {
    locale: 'ja-JP',
    outcome: 'escalated',
    daysAgo: 3,
    turns: ['会議室のプリンターで印刷できません。至急資料が必要です。'],
    ticketQuery: 'printer',
  },
  {
    locale: 'en',
    outcome: 'open',
    daysAgo: 1,
    turns: ['How do I share my Outlook calendar with my team?'],
  },
  {
    locale: 'zh-TW',
    outcome: 'open',
    daysAgo: 0,
    turns: ['公司 Wi-Fi 在 5 樓會議室一直斷線'],
  },
];

/** An auth context for a seeded person (their real permissions), so retrieval respects their access. */
async function authFor(
  ctx: ModuleContext,
  u: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    locale: string;
    timezone: string;
    departmentId: string | null;
    avatarUrl: string | null;
  },
): Promise<AuthContext> {
  const permissions = await ctx.rbac.permissionsFor(u.id);
  const user: SessionUser = { ...u, locale: normalizeLocale(u.locale) };
  return {
    principal: { type: 'user', id: u.id, name: u.displayName },
    user,
    sessionId: null,
    permissions,
    can: (p, r) => permissions.can(p, r),
    require(p, r) {
      if (!permissions.can(p, r)) throw new Error(`seed user lacks ${p}`);
    },
    reach: (p) => permissions.reach(p),
  };
}

const at = (daysAgo: number, minutes = 0) =>
  new Date(Date.now() - daysAgo * 86_400_000 - 3 * 3_600_000 + minutes * 60_000);

/** Builtin triage for open seeded tickets, as the agent identity; outcomes follow what agents chose. */
async function seedTriage(ctx: ModuleContext) {
  const agent = ctx.ai.agent();
  const svc = new AssistService(ctx);
  const open: { id?: string; type?: string }[] = [];
  try {
    for (const type of TRIAGE_TYPES)
      open.push(
        ...itemsOf(await svc.tools.call('itsm.find_tickets', { status: 'open', type, limit: 25 }, agent)),
      );
  } catch (err) {
    ctx.logger.info({ err }, 'ITSM tools unavailable — skipping Helpdesk AI triage seed');
    return 0;
  }
  let created = 0;
  for (const t of open) {
    if (!t.id || !(TRIAGE_TYPES as readonly string[]).includes(String(t.type))) continue;
    try {
      const row = await svc.triage(t.id, { auth: agent, trigger: 'seed', builtinOnly: true });
      if (!row) continue;
      created++;
      const ticket = await svc.tools.ticket(agent, { id: t.id });
      const s = (row.data as unknown as TriageData).suggestion;
      // What the agents chose, against what was suggested: all suggested fields kept = applied.
      const suggested: [TriageField, boolean][] = [];
      if (s.categoryId) suggested.push(['category', ticket.category?.id === s.categoryId]);
      if (s.assignmentGroupId) suggested.push(['group', ticket.assignmentGroup?.id === s.assignmentGroupId]);
      const agree = suggested.filter(([, ok]) => ok).map(([f]) => f);
      const status = !ticket.category
        ? 'suggested'
        : agree.length && agree.length === suggested.length
          ? 'applied'
          : agree.length
            ? 'partially_applied'
            : 'dismissed';
      await ctx.db
        .update(insights)
        .set({
          status,
          createdAt: new Date(ticket.createdAt),
          feedback:
            status === 'suggested'
              ? null
              : { action: status, fields: agree, by: { id: null, name: 'seed' }, at: ticket.updatedAt },
        })
        .where(eq(insights.id, row.id));
    } catch (err) {
      ctx.logger.warn({ err, ticketId: t.id }, 'could not seed triage for a ticket');
    }
  }
  return created;
}

async function seedConversations(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ n: count() }).from(conversations);
  if (existing!.n > 0) return 0;
  const people = await ctx.db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      locale: users.locale,
      timezone: users.timezone,
      departmentId: users.departmentId,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(
      and(
        eq(users.status, 'active'),
        ne(users.username, 'admin'),
        inArray(users.locale, ['en', 'zh-TW', 'ja-JP']),
      ),
    )
    .orderBy(users.username)
    .limit(300);
  if (!people.length) return 0;
  const byLocale = (l: ChatLocale) => people.filter((p) => p.locale === l);
  const agent = ctx.ai.agent();
  const svc = new AssistService(ctx);
  let made = 0;

  for (const [i, sc] of SCENARIOS.entries()) {
    const t = texts(sc.locale);
    let ticket: { id: string; reference: string; requesterId: string | null } | null = null;
    if (sc.outcome === 'escalated' && sc.ticketQuery) {
      try {
        const candidates = itemsOf<{ id?: string; type?: string }>(
          await svc.tools.call(
            'itsm.find_tickets',
            { query: sc.ticketQuery, status: 'all', limit: 10 },
            agent,
          ),
        ).filter((x) => x.id && (TRIAGE_TYPES as readonly string[]).includes(String(x.type)));
        // Prefer a ticket whose requester speaks the scenario's language: they "asked" the agent first.
        const full = await Promise.all(
          candidates.slice(0, 6).map((c) => svc.tools.ticket(agent, { id: c.id! })),
        );
        const best = full.find((t) => t.requester?.locale === sc.locale) ?? full.find((t) => t.requester);
        if (best) ticket = { id: best.id, reference: best.reference, requesterId: best.requester!.id };
      } catch {
        ticket = null;
      }
    }
    const pool = byLocale(sc.locale).length ? byLocale(sc.locale) : people;
    const person =
      (ticket?.requesterId && people.find((p) => p.id === ticket!.requesterId)) ||
      pool[(i * 7) % pool.length]!;
    const auth = await authFor(ctx, person);

    const registry = new CitationRegistry();
    const rows: (typeof messages.$inferInsert)[] = [];
    let minute = 0;
    let lastFound: Citation[] = [];
    for (const [n, turn] of sc.turns.entries()) {
      rows.push({
        conversationId: '',
        seq: 0,
        role: 'user',
        content: turn,
        createdAt: at(sc.daysAgo, minute++),
      });
      const hits = await svc.tools.searchArticles(
        auth,
        sc.turns.slice(Math.max(0, n - 1), n + 1).join('\n'),
        {
          limit: 5,
        },
      );
      lastFound = relevantHits(hits, RELEVANCE.answer).map((h) =>
        registry.add({ id: h.id, reference: h.reference, title: h.title, href: h.href, snippet: teaser(h) }),
      );
      const proposal = builtinProposal(sc.locale, sc.turns.slice(0, n + 1), lastFound);
      rows.push({
        conversationId: '',
        seq: 0,
        role: 'assistant',
        content: builtinAnswer(sc.locale, lastFound, true),
        citations: lastFound,
        proposal: sc.outcome === 'deflected' && lastFound.length ? null : proposal,
        mode: 'builtin',
        createdAt: at(sc.daysAgo, minute++),
      });
    }
    const escalated = sc.outcome === 'escalated' && ticket;
    if (escalated)
      rows.push({
        conversationId: '',
        seq: 0,
        role: 'assistant',
        content: t('chat', 'ticketCreated', { reference: ticket!.reference }),
        mode: 'builtin',
        createdAt: at(sc.daysAgo, minute + 2),
      });

    await ctx.transaction(async (tx) => {
      const [conv] = await tx
        .insert(conversations)
        .values({
          userId: person.id,
          title: sc.turns[0]!.slice(0, 120),
          locale: sc.locale,
          status: escalated ? 'escalated' : sc.outcome === 'deflected' ? 'resolved' : 'open',
          ticketId: escalated ? ticket!.id : null,
          ticketRef: escalated ? ticket!.reference : null,
          deflected: sc.outcome === 'deflected',
          mode: 'builtin',
          messageCount: rows.length,
          outcomeAt: sc.outcome === 'open' ? null : at(sc.daysAgo, minute + 3),
          createdAt: at(sc.daysAgo),
          updatedAt: at(sc.daysAgo, minute + 3),
        })
        .returning({ id: conversations.id });
      await tx.insert(messages).values(rows.map((r, seq) => ({ ...r, conversationId: conv!.id, seq })));
    });
    made++;
  }
  return made;
}

/** Idempotent demo data: triage insights for open tickets and sample conversations in three languages. */
export async function seed(ctx: ModuleContext) {
  const triaged = await seedTriage(ctx);
  const chats = await seedConversations(ctx);
  ctx.logger.info({ triaged, conversations: chats }, 'Helpdesk AI demo data');
}
