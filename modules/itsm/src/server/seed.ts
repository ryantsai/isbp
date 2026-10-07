/**
 * Demo data: categories, calendars, SLA policies, catalog mappings, agent roles and ~150 tickets over
 * the last 60 days with realistic timelines (SLA timers computed for real), problems with linked
 * incidents, changes (one waiting for CAB approval through the real workflow) and an open major
 * incident. Idempotent: does nothing when tickets exist.
 */
import { formSubmissions, forms, groupMembers, groups, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import type { Db, ModuleContext } from '@isbp/sdk/server';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { priorityFor, type TicketStatus } from '../contracts';
import { localDay, localToInstant } from './business-time';
import { invalidateLookups } from './lookups';
import { SOLVED_STATUSES } from './rules';
import {
  businessCalendars,
  catalogItems,
  categories,
  type Channel,
  problems as problemsTable,
  slaPolicies,
  ticketActivities,
  ticketLinks,
  tickets,
} from './schema';
import {
  ALWAYS,
  CATALOG,
  CATEGORIES,
  type CategorySeed,
  CHAT,
  CSAT_COMMENTS,
  POLICIES,
  PROBLEMS,
  type SeedLocale,
  TAIPEI_HOURS,
  TAIWAN_HOLIDAYS_2026,
  TEMPLATES,
  type TicketTemplate,
} from './seed-data';
import { services } from './services';
import { type Actor, SYSTEM_ACTOR } from './tickets';

type TicketRow = typeof tickets.$inferSelect;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TZ = 'Asia/Taipei';

/** Deterministic PRNG so every fresh seed looks the same. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Person {
  id: string;
  username: string;
  displayName: string;
  locale: string;
  departmentId: string | null;
}

const asActor = (id: string | null): Actor => ({ authorId: id, authorName: null, authorAi: false });

export async function seed(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ n: count() }).from(tickets);
  if (existing!.n > 0) return;
  const db = ctx.db;
  const { tickets: svc, fulfilment } = services(ctx);
  const r = mulberry32(20_261_006);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const between = (a: number, b: number) => a + r() * (b - a);
  const now = new Date();
  const latest = now.getTime() - 2 * MIN;
  const clamp = (t: number) => new Date(Math.min(t, latest));

  /* ───────────── groups, roles and people ───────────── */

  const groupRows = await db.select({ id: groups.id, key: groups.key }).from(groups);
  const groupId = (key: string) => groupRows.find((g) => g.key === key)?.id ?? null;
  const people = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      locale: users.locale,
      departmentId: users.departmentId,
    })
    .from(users)
    .where(eq(users.status, 'active'));
  if (!people.length) return;
  const byUsername = (u: string) => people.find((p) => p.username === u);
  const admin = byUsername('admin');
  const helpdesk = byUsername('helpdesk');

  // Agent and change-manager roles are granted by the core demo seed (modules never write core tables).

  const memberRows = await db
    .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(users.status, 'active'));
  const agentsOf = (key: string): Person[] => {
    const gid = groupId(key);
    const ids = new Set(memberRows.filter((m) => m.groupId === gid).map((m) => m.userId));
    const list = people.filter((p) => ids.has(p.id)).slice(0, 8);
    if (key === 'service-desk' && helpdesk && !list.some((p) => p.id === helpdesk.id)) list.unshift(helpdesk);
    return list.length ? list : [helpdesk ?? admin ?? people[0]!];
  };
  const agentIds = new Set(
    ['service-desk', 'network-team', 'security-team', 'dba-team', 'it-admins'].flatMap((k) =>
      agentsOf(k).map((p) => p.id),
    ),
  );
  const requesters = people.filter((p) => !agentIds.has(p.id) && p.username !== 'admin');
  const requesterFor = (locale: SeedLocale): Person => {
    const fit = requesters.filter((p) => p.locale === locale);
    return pick(fit.length ? fit : requesters.length ? requesters : people);
  };

  /* ───────────── configuration ───────────── */

  const catIds = new Map<string, string>();
  const catGroup = new Map<string, string>();
  const insertCategory = async (c: CategorySeed, parentId: string | null, order: number) => {
    const [row] = await db
      .insert(categories)
      .values({
        key: c.key,
        name: c.name,
        parentId,
        ticketTypes: ['incident', 'service_request', 'problem', 'change'],
        defaultGroupId: groupId(c.group),
        sortOrder: order * 10,
      })
      .onConflictDoUpdate({ target: categories.key, set: { name: c.name } })
      .returning();
    catIds.set(c.key, row!.id);
    catGroup.set(c.key, c.group);
    for (const [i, child] of (c.children ?? []).entries()) await insertCategory(child, row!.id, i);
  };
  for (const [i, c] of CATEGORIES.entries()) await insertCategory(c, null, i);

  const [taipei] = await db
    .insert(businessCalendars)
    .values({
      name: 'Taipei office hours',
      timezone: TZ,
      hours: TAIPEI_HOURS,
      holidays: TAIWAN_HOLIDAYS_2026,
    })
    .returning();
  const [always] = await db
    .insert(businessCalendars)
    .values({ name: '24×7', timezone: 'UTC', hours: ALWAYS, holidays: [], alwaysOpen: true })
    .returning();
  for (const p of POLICIES)
    await db.insert(slaPolicies).values({
      name: p.name,
      description: p.description,
      ticketTypes: p.ticketTypes,
      condition: p.condition,
      targets: p.targets,
      calendarId: p.calendar === 'taipei' ? taipei!.id : always!.id,
      pauseStatuses: p.pauseStatuses,
      warnAt: p.warnAt,
      sortOrder: p.sortOrder,
    });

  const published = new Set((await ctx.forms.published()).map((f) => f.key));
  for (const c of CATALOG)
    if (published.has(c.formKey))
      await db
        .insert(catalogItems)
        .values({
          formKey: c.formKey,
          categoryId: catIds.get(c.category) ?? null,
          groupId: groupId(c.group),
          priority: c.priority,
          fulfilOn: c.fulfilOn,
        })
        .onConflictDoNothing();
  invalidateLookups();

  const ciRows = await db.select({ id: cis.id, name: cis.name }).from(cis);
  const ciIds = (names: readonly string[] | undefined) =>
    (names ?? []).map((n) => ciRows.find((c) => c.name === n)?.id).filter((x): x is string => Boolean(x));

  /* ───────────── helpers ───────────── */

  /** A weekday working-hours instant `daysAgo` days back (Taipei). */
  const officeTime = (daysAgo: number) => {
    let day = localDay(now.getTime(), TZ) - Math.floor(daysAgo);
    const wd = new Date(day * DAY).getUTCDay();
    if (wd === 0) day -= 2;
    if (wd === 6) day -= 1;
    const at = localToInstant(day, Math.floor(between(8.5 * 60, 18 * 60)), TZ);
    return new Date(Math.min(at, now.getTime() - between(20, 240) * MIN));
  };
  const channel = (): Channel => {
    const x = r();
    return x < 0.55 ? 'portal' : x < 0.7 ? 'email' : x < 0.85 ? 'phone' : x < 0.95 ? 'chat' : 'agent';
  };
  const resolutionCodeOf = (tpl: TicketTemplate) =>
    tpl.code ?? (r() < 0.82 ? 'solved' : pick(['workaround', 'user_error', 'no_fault_found'] as const));

  const assign = async (tx: Db, t: TicketRow, agent: Person, at: Date) => {
    const [row] = await tx
      .update(tickets)
      .set({ assigneeId: agent.id, updatedAt: at })
      .where(eq(tickets.id, t.id))
      .returning();
    await svc.activity(tx, t.id, asActor(agent.id), {
      kind: 'assignment',
      public: false,
      data: {
        from: { groupId: t.assignmentGroupId, assigneeId: null },
        to: { groupId: t.assignmentGroupId, assigneeId: agent.id },
      },
      at,
    });
    return row!;
  };
  const say = (tx: Db, t: TicketRow, who: Person, body: string, at: Date, isPublic = true) =>
    svc.activity(tx, t.id, asActor(who.id), {
      kind: isPublic ? 'comment' : 'work_note',
      public: isPublic,
      body,
      at,
    });

  const created: TicketRow[] = [];
  const byProblem = new Map<string, TicketRow[]>();

  /** Raises a ticket from a template and plays its story up to `final`. */
  const story = async (tpl: TicketTemplate, final: TicketStatus, createdAt: Date) => {
    const locale = tpl.locale ?? 'en';
    const chat = CHAT[locale];
    const requester = requesterFor(locale);
    const groupKey = catGroup.get(tpl.category) ?? 'service-desk';
    const agent = pick(agentsOf(groupKey));
    const impact = tpl.impact ?? (r() < 0.55 ? 2 : 3);
    const urgency = tpl.urgency ?? (r() < 0.2 ? 1 : r() < 0.75 ? 2 : 3);
    const ch = channel();
    const solved: TicketStatus = tpl.type === 'service_request' ? 'fulfilled' : 'resolved';
    return ctx.transaction(async (tx) => {
      let t = await svc.insertTicket(
        tx,
        {
          type: tpl.type,
          title: tpl.title,
          description: tpl.description,
          impact,
          urgency,
          categoryId: catIds.get(tpl.category) ?? null,
          requesterId: requester.id,
          requestedForId: null,
          departmentId: requester.departmentId,
          assignmentGroupId: groupId(groupKey),
          assigneeId: null,
          channel: ch,
          major: false,
          attributes: {},
          manualFields: ch === 'phone' || ch === 'agent' ? ['category', 'impact'] : [],
          createdBy: ch === 'phone' || ch === 'agent' ? agent.id : requester.id,
          createdAt,
          ciIds: ciIds(tpl.cis),
        },
        asActor(ch === 'phone' || ch === 'agent' ? agent.id : requester.id),
        { quiet: true },
      );
      if (ch !== 'phone' && ch !== 'agent' && r() < 0.6)
        await tx
          .update(tickets)
          .set({
            triagedAt: new Date(createdAt.getTime() + 20_000),
            triagedBy: { type: 'agent', id: agent.id, name: agent.displayName },
          })
          .where(eq(tickets.id, t.id));
      if (final === 'new') return t;

      const priority = priorityFor(impact, urgency);
      const pickup = priority <= 2 ? between(5, 40) : between(15, 180);
      let at = clamp(createdAt.getTime() + pickup * MIN);
      t = await assign(tx, t, agent, at);
      const conversation = r() < 0.65;
      if (conversation) {
        at = clamp(at.getTime() + between(1, 10) * MIN);
        t = await svc.applyStatus(tx, t, 'in_progress', { actor: asActor(agent.id), now: at, quiet: true });
        await say(tx, t, agent, pick(chat.ask), at);
        at = clamp(at.getTime() + between(10, 120) * MIN);
        await say(tx, t, requester, pick(chat.answer), at);
        if (r() < 0.5) {
          at = clamp(at.getTime() + between(5, 60) * MIN);
          await say(tx, t, agent, pick(chat.note), at, false);
        }
      } else {
        t = await svc.applyStatus(tx, t, 'in_progress', { actor: asActor(agent.id), now: at, quiet: true });
      }
      if (final === 'in_progress') return touch(tx, t, at);
      if (final === 'on_hold' || r() < 0.12) {
        at = clamp(at.getTime() + between(10, 90) * MIN);
        t = await svc.applyStatus(tx, t, 'on_hold', {
          actor: asActor(agent.id),
          now: at,
          note: pick(chat.hold),
          quiet: true,
        });
        if (final === 'on_hold') return touch(tx, t, at);
        at = clamp(at.getTime() + between(2, 30) * HOUR);
        t = await svc.applyStatus(tx, t, 'in_progress', { actor: asActor(agent.id), now: at, quiet: true });
      }
      const work =
        priority <= 2
          ? between(1, 6) * HOUR
          : priority === 3
            ? between(3, 40) * HOUR
            : between(20, 90) * HOUR;
      at = clamp(Math.max(at.getTime() + 10 * MIN, createdAt.getTime() + work));
      t = await svc.applyStatus(tx, t, solved, {
        actor: asActor(agent.id),
        now: at,
        resolutionCode: resolutionCodeOf(tpl),
        resolutionNotes: tpl.resolution,
        quiet: true,
      });
      if (final === solved) return t;

      if (r() < 0.6) {
        // The requester confirms (most rate the service).
        at = clamp(at.getTime() + between(0.5, 30) * HOUR);
        const rating = r() < 0.68 ? (r() < 0.7 ? 5 : r() < 0.7 ? 4 : 3) : null;
        if (rating)
          await tx
            .update(tickets)
            .set({ satisfaction: rating, satisfactionComment: r() < 0.4 ? pick(CSAT_COMMENTS) : null })
            .where(eq(tickets.id, t.id));
        await say(tx, t, requester, pick(chat.thanks), at);
        t = await svc.applyStatus(tx, t, 'closed', {
          actor: asActor(requester.id),
          now: at,
          data: { confirmed: true, ...(rating ? { rating } : {}) },
          quiet: true,
        });
      } else {
        at = clamp(at.getTime() + 5 * DAY);
        t = await svc.applyStatus(tx, t, 'closed', {
          actor: SYSTEM_ACTOR,
          now: at,
          data: { auto: true, days: 5 },
          quiet: true,
        });
      }
      return t;
    });
  };
  const touch = async (tx: Db, t: TicketRow, at: Date) => {
    const [row] = await tx.update(tickets).set({ updatedAt: at }).where(eq(tickets.id, t.id)).returning();
    return row!;
  };

  /* ───────────── problems ───────────── */

  const problemRows = new Map<string, TicketRow>();
  for (const p of PROBLEMS) {
    const owner = pick(agentsOf(catGroup.get(p.category) ?? 'service-desk'));
    const createdAt = officeTime(between(18, 32));
    const t = await ctx.transaction(async (tx) => {
      let row = await svc.insertTicket(
        tx,
        {
          type: 'problem',
          title: p.title,
          description: p.description,
          impact: 1,
          urgency: 2,
          categoryId: catIds.get(p.category) ?? null,
          requesterId: helpdesk?.id ?? owner.id,
          requestedForId: null,
          departmentId: (helpdesk ?? owner).departmentId,
          assignmentGroupId: groupId(catGroup.get(p.category) ?? 'service-desk'),
          assigneeId: owner.id,
          channel: 'agent',
          major: false,
          attributes: {},
          manualFields: ['category', 'group', 'assignee', 'impact', 'urgency'],
          createdBy: helpdesk?.id ?? owner.id,
          createdAt,
          ciIds: ciIds(p.cis),
          problem: { rootCause: '', workaround: '', knownError: false },
        },
        asActor(helpdesk?.id ?? owner.id),
        { quiet: true },
      );
      if (p.status === 'new') return row;
      let at = new Date(createdAt.getTime() + between(1, 6) * HOUR);
      row = await svc.applyStatus(tx, row, 'investigating', {
        actor: asActor(owner.id),
        now: at,
        quiet: true,
      });
      await tx
        .update(problemsTable)
        .set({ rootCause: p.rootCause, workaround: p.workaround })
        .where(eq(problemsTable.ticketId, row.id));
      if (p.status === 'known_error' || p.status === 'resolved') {
        at = new Date(at.getTime() + between(2, 6) * DAY);
        row = await svc.applyStatus(tx, row, 'known_error', {
          actor: asActor(owner.id),
          now: at,
          note: `Root cause confirmed. Workaround: ${p.workaround}`,
          quiet: true,
        });
      }
      if (p.status === 'resolved') {
        at = clamp(at.getTime() + between(3, 8) * DAY);
        row = await svc.applyStatus(tx, row, 'resolved', {
          actor: asActor(owner.id),
          now: at,
          resolutionCode: 'solved',
          resolutionNotes: 'Removed the leaking driver and replaced it with the vendor’s universal driver.',
          quiet: true,
        });
      }
      return row;
    });
    problemRows.set(p.key, t);
    created.push(t);
  }

  /* ───────────── incidents and service requests ───────────── */

  const plan: TicketTemplate[] = TEMPLATES.flatMap((tpl) =>
    Array.from({ length: tpl.times ?? 1 }, () => tpl),
  );
  const incidents = TEMPLATES.filter((t) => t.type === 'incident');
  const requests = TEMPLATES.filter((t) => t.type === 'service_request');
  while (plan.filter((p) => p.type === 'incident').length < 100) plan.push(pick(incidents));
  while (plan.filter((p) => p.type === 'service_request').length < 30) plan.push(pick(requests));
  // Shuffle (deterministically) so statuses and dates are spread over every theme.
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [plan[i], plan[j]] = [plan[j]!, plan[i]!];
  }

  for (const tpl of plan) {
    const x = r();
    let final: TicketStatus;
    let createdAt: Date;
    if (x < 0.35) {
      const y = r();
      final = y < 0.25 ? 'new' : y < 0.75 ? 'in_progress' : 'on_hold';
      createdAt = officeTime(r() < 0.72 ? between(0, 3) : between(4, 20));
    } else if (x < 0.45) {
      final = tpl.type === 'service_request' ? 'fulfilled' : 'resolved';
      createdAt = officeTime(between(1, 4));
    } else {
      final = 'closed';
      createdAt = officeTime(between(6, 60));
    }
    const t = await story(tpl, final, createdAt);
    created.push(t);
    if (tpl.problem) byProblem.set(tpl.problem, [...(byProblem.get(tpl.problem) ?? []), t]);
  }

  // Incidents caused by the problems.
  for (const [key, list] of byProblem) {
    const problem = problemRows.get(key);
    if (!problem) continue;
    const linked = list.slice(0, key === 'vpn-macos' ? 8 : 4);
    if (linked.length)
      await db
        .insert(ticketLinks)
        .values(
          linked.map((t) => ({
            sourceId: t.id,
            targetId: problem.id,
            type: 'caused_by' as const,
            createdBy: problem.assigneeId,
          })),
        )
        .onConflictDoNothing();
  }

  /* ───────────── at risk right now (24×7 P1s) and the major incident ───────────── */

  const sd = agentsOf('service-desk');
  const itAdmins = agentsOf('it-admins');
  const p1 = async (
    title: string,
    description: string,
    minutesAgo: number,
    category: string,
    ciNames: string[],
    opts: { major?: boolean; agent?: Person } = {},
  ) => {
    const requester = requesterFor('en');
    const agent = opts.agent ?? pick(sd);
    const createdAt = new Date(now.getTime() - minutesAgo * MIN);
    return ctx.transaction(async (tx) => {
      let t = await svc.insertTicket(
        tx,
        {
          type: 'incident',
          title,
          description,
          impact: 1,
          urgency: 1,
          categoryId: catIds.get(category) ?? null,
          requesterId: requester.id,
          requestedForId: null,
          departmentId: requester.departmentId,
          assignmentGroupId: groupId(catGroup.get(category) ?? 'service-desk'),
          assigneeId: null,
          channel: 'phone',
          major: Boolean(opts.major),
          attributes: {},
          manualFields: ['impact', 'urgency', 'category'],
          createdBy: agent.id,
          createdAt,
          ciIds: ciIds(ciNames),
        },
        asActor(agent.id),
        { quiet: true },
      );
      let at = new Date(createdAt.getTime() + 6 * MIN);
      t = await assign(tx, t, agent, at);
      t = await svc.applyStatus(tx, t, 'in_progress', { actor: asActor(agent.id), now: at, quiet: true });
      at = new Date(at.getTime() + 8 * MIN);
      await say(tx, t, agent, 'We are on it and will post updates here every 30 minutes.', at);
      at = new Date(at.getTime() + 25 * MIN);
      await say(tx, t, agent, 'Engaged the vendor; collecting diagnostics.', at, false);
      return touch(tx, t, at);
    });
  };
  const major = await p1(
    'Email delivery delays for all staff',
    'Since about 09:10 inbound and outbound email is delayed by 20–40 minutes for everyone. The relay queue on mail-relay-01 keeps growing. Teams chat is not affected.',
    95,
    'collaboration-outlook',
    ['Email & Calendar', 'mail-relay-01'],
    { major: true, agent: pick(itAdmins) },
  );
  created.push(major);
  for (const [i, title] of [
    'Customers say our replies arrive late',
    'Emails to the bank are stuck in my Outbox',
    'Not receiving any external email since this morning',
  ].entries()) {
    const requester = requesterFor('en');
    const child = await ctx.transaction((tx) =>
      svc.insertTicket(
        tx,
        {
          type: 'incident',
          title,
          description: 'Emails are not going out / coming in on time. Is something wrong with email?',
          impact: 3,
          urgency: 1,
          categoryId: catIds.get('collaboration-outlook') ?? null,
          requesterId: requester.id,
          requestedForId: null,
          departmentId: requester.departmentId,
          assignmentGroupId: groupId('it-admins'),
          assigneeId: null,
          channel: 'portal',
          major: false,
          attributes: {},
          manualFields: [],
          createdBy: requester.id,
          createdAt: new Date(now.getTime() - (80 - i * 20) * MIN),
          ciIds: ciIds(['Email & Calendar']),
        },
        asActor(requester.id),
        { quiet: true },
      ),
    );
    await db
      .insert(ticketLinks)
      .values({ sourceId: major.id, targetId: child.id, type: 'parent_of', createdBy: major.assigneeId });
    created.push(child);
  }
  created.push(
    await p1(
      'Finance ERP down for the AP team',
      'Nobody in accounts payable can sign in to the Finance ERP: the login page spins and times out. Payment run is due today.',
      200,
      'business-apps-erp',
      ['Finance ERP', 'erp-app-01'],
    ),
    await p1(
      'Taipei office cannot reach the internet',
      'Several floors lost internet access. Internal systems still work. Firewall tpe-fw-01 shows high CPU.',
      215,
      'network-wired',
      ['tpe-fw-01', 'tpe-sw-core-01'],
    ),
  );

  /* ───────────── changes ───────────── */

  const nextSaturday = (() => {
    const today = localDay(now.getTime(), TZ);
    for (let d = today + 3; ; d++) if (new Date(d * DAY).getUTCDay() === 6) return d;
  })();
  const at = (day: number, hour: number) => new Date(localToInstant(day, hour * 60, TZ));
  const todayDay = localDay(now.getTime(), TZ);
  const network = agentsOf('network-team');
  const dba = agentsOf('dba-team');
  const changeOwner = network.find((p) => p.id !== admin?.id) ?? pick(sd);
  const emergency = officeTime(12);
  const wlcUpgrade = officeTime(3);
  const migration = officeTime(24);

  const change = async (c: {
    title: string;
    description: string;
    changeType: 'standard' | 'normal' | 'emergency';
    risk: 'low' | 'medium' | 'high';
    start: Date;
    end: Date;
    cis: string[];
    owner: Person;
    group?: string;
    status: TicketStatus;
    createdDaysAgo: number;
    submit?: boolean;
    reason: string;
    plan: string;
    backout: string;
    test: string;
  }) => {
    const createdAt = officeTime(c.createdDaysAgo);
    const t = await ctx.transaction(async (tx) => {
      const row = await svc.insertTicket(
        tx,
        {
          type: 'change',
          title: c.title,
          description: c.description,
          status: c.submit ? 'assessment' : c.status,
          impact: c.risk === 'high' ? 1 : 2,
          urgency: c.changeType === 'emergency' ? 1 : 2,
          categoryId: null,
          requesterId: c.owner.id,
          requestedForId: null,
          departmentId: c.owner.departmentId,
          assignmentGroupId: groupId(c.group ?? 'network-team'),
          assigneeId: c.owner.id,
          channel: 'agent',
          major: false,
          attributes: {},
          manualFields: ['impact', 'urgency', 'group', 'assignee'],
          createdBy: c.owner.id,
          createdAt,
          ciIds: ciIds(c.cis),
          change: {
            changeType: c.changeType,
            risk: c.risk,
            reason: c.reason,
            plannedStart: c.start,
            plannedEnd: c.end,
            implementationPlan: c.plan,
            backoutPlan: c.backout,
            testPlan: c.test,
          },
        },
        asActor(c.owner.id),
        { quiet: true },
      );
      if (!c.submit && c.status !== 'draft') {
        await svc.activity(tx, row.id, SYSTEM_ACTOR, {
          kind: 'approval',
          public: false,
          data: { event: 'approved' },
          at: new Date(createdAt.getTime() + 20 * HOUR),
        });
        await svc.activity(tx, row.id, asActor(c.owner.id), {
          kind: 'status',
          public: true,
          data: { from: 'draft', to: c.status },
          at: new Date(createdAt.getTime() + 21 * HOUR),
        });
      }
      return row;
    });
    const result = c.submit
      ? await svc.submitChange(t, asActor(c.owner.id), c.owner.id, undefined, { quiet: true })
      : t;
    created.push(result);
    return result;
  };

  await change({
    title: 'Monthly Windows security patching — pilot ring',
    description:
      'Install this month’s cumulative updates on the 40 pilot laptops (IT staff) before the broad rollout.',
    changeType: 'standard',
    risk: 'low',
    start: at(todayDay + 6, 19),
    end: at(todayDay + 6, 22),
    cis: [],
    owner: pick(sd),
    group: 'service-desk',
    status: 'scheduled',
    createdDaysAgo: 2,
    submit: true,
    reason: 'Monthly patch cycle (pre-approved standard change).',
    plan: '1. Approve updates for the pilot collection.\n2. Force install at 19:00 with a 2-hour deadline.\n3. Monitor compliance.',
    backout: 'Uninstall the cumulative update through the management console.',
    test: 'Pilot users confirm sign-in, VPN, Outlook and Teams the next morning.',
  });
  await change({
    title: 'Renew TLS certificate on mail-relay-01',
    description:
      'The public certificate of the outbound mail relay expires in 12 days. Replace it with the renewed certificate.',
    changeType: 'normal',
    risk: 'low',
    start: at(todayDay + 5, 21),
    end: at(todayDay + 5, 22),
    cis: ['mail-relay-01', 'Email & Calendar'],
    owner: changeOwner,
    status: 'authorization',
    createdDaysAgo: 1,
    submit: true,
    reason: 'Certificate expiry would stop outbound email to partners that enforce TLS.',
    plan: '1. Import the renewed certificate.\n2. Bind it to the SMTP connector.\n3. Restart the transport service.',
    backout: 'Re-bind the current certificate (valid for 12 more days).',
    test: 'Send test messages to external mailboxes and check the TLS handshake.',
  });
  await change({
    title: 'Core switch firmware upgrade tpe-sw-core-01',
    description:
      'Upgrade the Taipei core switch stack to the vendor’s recommended release (fixes two security advisories).',
    changeType: 'normal',
    risk: 'high',
    start: at(nextSaturday, 22),
    end: at(nextSaturday + 1, 2),
    cis: ['tpe-sw-core-01'],
    owner: changeOwner,
    status: 'scheduled',
    createdDaysAgo: 9,
    reason: 'Security advisories for the current firmware; the vendor ends support for it next quarter.',
    plan: '1. Back up the configuration.\n2. Upgrade the standby member, fail over.\n3. Upgrade the second member.\n4. Verify routing and uplinks.',
    backout: 'Boot both members from the previous image (kept on flash); restore the configuration backup.',
    test: 'Ping sweep of every VLAN gateway, VPN and Wi-Fi checks, ERP and email smoke tests.',
  });
  await change({
    title: 'ERP database index rebuild',
    description: 'Rebuild fragmented indexes on the Finance ERP database before month-end close.',
    changeType: 'normal',
    risk: 'medium',
    start: at(nextSaturday, 20),
    end: at(nextSaturday, 23),
    cis: ['erp-db-01', 'Finance ERP'],
    owner: dba[0] ?? changeOwner,
    group: 'dba-team',
    status: 'scheduled',
    createdDaysAgo: 6,
    reason: 'Posting performance degrades with index fragmentation above 40%.',
    plan: 'Run the online index rebuild job for the GL and AP schemas.',
    backout: 'Stop the job; online rebuilds leave the existing indexes in place.',
    test: 'Compare posting times before and after.',
  });
  await change({
    title: 'ERP application server OS patching',
    description: 'Apply operating system patches to erp-app-01 and restart the application service.',
    changeType: 'normal',
    risk: 'medium',
    start: at(nextSaturday, 22),
    end: at(nextSaturday + 1, 1),
    cis: ['erp-app-01', 'Finance ERP'],
    owner: changeOwner,
    status: 'scheduled',
    createdDaysAgo: 4,
    reason: 'Quarterly OS patching.',
    plan: 'Drain the node, patch, reboot, return to the pool.',
    backout: 'Restore the VM snapshot taken before patching.',
    test: 'Sign in to the ERP and post a test journal.',
  });
  await change({
    title: 'Emergency firewall rule to block phishing domain',
    description: 'Block the domains used by the active phishing campaign at the perimeter firewall.',
    changeType: 'emergency',
    risk: 'medium',
    start: emergency,
    end: new Date(emergency.getTime() + 30 * MIN),
    cis: ['tpe-fw-01'],
    owner: agentsOf('security-team')[0] ?? changeOwner,
    group: 'security-team',
    status: 'closed',
    createdDaysAgo: 12,
    reason: 'Several users received credential-phishing emails; one clicked the link.',
    plan: 'Add the domains to the block list and push the policy.',
    backout: 'Remove the block-list entries.',
    test: 'Confirm the domains are blocked from a test workstation.',
  });
  await change({
    title: 'Upgrade Wi-Fi controller wlc-01 to 8.10',
    description:
      'Upgrade the wireless controller to fix client roaming issues (see the Wi-Fi roaming problem).',
    changeType: 'normal',
    risk: 'medium',
    start: wlcUpgrade,
    end: new Date(wlcUpgrade.getTime() + 2 * HOUR),
    cis: ['wlc-01', 'Wi-Fi'],
    owner: changeOwner,
    status: 'review',
    createdDaysAgo: 10,
    reason: 'Release 8.10 fixes fast-roaming failures between access points.',
    plan: 'Upgrade the controller after hours; access points download the new image automatically.',
    backout: 'Downgrade to 8.5 from the backup partition.',
    test: 'Walk test between meeting rooms on 5F–7F.',
  });
  await change({
    title: 'Migrate departmental file shares to nas-01',
    description: 'Move the Finance, HR and Sales shares from the old file server to nas-01.',
    changeType: 'normal',
    risk: 'medium',
    start: migration,
    end: new Date(migration.getTime() + 6 * HOUR),
    cis: ['nas-01', 'File Sharing'],
    owner: changeOwner,
    status: 'closed',
    createdDaysAgo: 30,
    reason: 'The old file server is out of support.',
    plan: 'Robocopy with permissions, switch the DFS targets, keep the old server read-only for 2 weeks.',
    backout: 'Switch the DFS targets back.',
    test: 'Owners of each share open and save files.',
  });

  /* ───────────── existing catalog requests (Phase 1 seed) ───────────── */

  const mapped = await db.select().from(catalogItems);
  if (mapped.length) {
    const subs = await db
      .select({
        id: formSubmissions.id,
        status: formSubmissions.status,
        createdAt: formSubmissions.createdAt,
        completedAt: formSubmissions.completedAt,
        key: forms.key,
      })
      .from(formSubmissions)
      .innerJoin(forms, eq(forms.id, formSubmissions.formId))
      .where(
        and(
          inArray(
            forms.key,
            mapped.map((m) => m.formKey),
          ),
          inArray(formSubmissions.status, ['submitted', 'approved', 'pending']),
        ),
      );
    for (const s of subs) {
      const m = mapped.find((x) => x.formKey === s.key)!;
      if (s.status === 'pending' && m.fulfilOn !== 'submitted') continue;
      const info = await ctx.forms.submission(s.id);
      if (!info) continue;
      const start = new Date((s.completedAt ?? s.createdAt).getTime() + 3 * MIN);
      let t = await fulfilment.fulfil(info, m, { quiet: true, at: clamp(start.getTime()) });
      if (!t) continue;
      const age = (now.getTime() - start.getTime()) / DAY;
      if (age > 1) {
        const agent = pick(sd);
        t = await ctx.transaction(async (tx) => {
          let row = await assign(tx, t!, agent, clamp(start.getTime() + 40 * MIN));
          row = await svc.applyStatus(tx, row, 'in_progress', {
            actor: asActor(agent.id),
            now: clamp(start.getTime() + 41 * MIN),
            quiet: true,
          });
          if (age > 4)
            row = await svc.applyStatus(tx, row, 'fulfilled', {
              actor: asActor(agent.id),
              now: clamp(start.getTime() + between(20, 70) * HOUR),
              resolutionCode: 'solved',
              resolutionNotes:
                s.key === 'lost-device'
                  ? 'Device wiped remotely, sessions revoked and a replacement ordered.'
                  : s.key === 'software-request'
                    ? 'Software installed and license assigned.'
                    : 'Equipment delivered and set up at the requester’s desk.',
              quiet: true,
            });
          return row;
        });
      }
      created.push(t!);
    }
  }

  /* ───────────── timers due now, and the similar-ticket index ───────────── */

  await svc.sla.monitor(new Date());
  for (const t of created) {
    const [row] = await db
      .select({ id: tickets.id, status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, t.id));
    if (row && (SOLVED_STATUSES.includes(row.status) || row.status === 'closed')) await svc.index(row.id);
  }
  // Comments written above may be newer than the ticket's last status change.
  await db.execute(
    sql`update itsm.tickets t set updated_at = greatest(t.updated_at, coalesce((select max(a.created_at) from ${ticketActivities} a where a.ticket_id = t.id), t.updated_at))`,
  );
  ctx.logger.info({ tickets: created.length }, 'itsm demo data created');
}
