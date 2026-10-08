/**
 * Account reviews of any system (servers, network devices, databases, applications): a reviewer goes through the
 * system's accounts — imported from the system's export (CSV), filled from the role holders of an application
 * registered in the platform, or added by hand — and decides keep, disable or delete for each, with the date a
 * disable or delete was done. The review is completed when every item is decided, then signed off by a security
 * officer. A recurring review (quarterly or yearly) schedules the next one at sign-off; the daily job opens it on its
 * start date and tells the reviewer. Disable and delete decisions can raise ITSM tickets through ITSM's own AI tool,
 * as the person asking (`ctx.ai.tools.invoke`), so ITSM applies its rules.
 */
import { applications, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  httpErrors,
  likePattern,
  type ModuleContext,
  parseRecordRef,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  addReviewItemSchema,
  createReviewSchema,
  decideItemSchema,
  reviewItemQuerySchema,
  reviewQuerySchema,
} from '../contracts';
import {
  addMonths,
  daysBetween,
  formatRef,
  isUuid,
  itemDecided,
  normalizeName,
  parseAccountState,
  parseLooseDate,
  parsePrivilege,
  parseRef,
  privilegeOfRoles,
  readCsvTable,
  recurrenceMonths,
  REVIEW_COLUMNS,
  REVIEW_DECISIONS,
  REVIEW_IMPORT_MAX_ROWS,
  type ReviewColumn,
  type ReviewDecision,
  reviewProgress,
  toCsv,
} from '../model';
import {
  canDecideReview,
  canManageReviews,
  canReadAllReviews,
  canReadReview,
  canSignOffReviews,
  P,
} from './access';
import { type ReviewItemRow, reviewItems, type ReviewRow, reviews } from './schema';
import {
  actingUserId,
  activePeople,
  CATALOGS,
  companyToday,
  invalidField,
  invalidState,
  ismsConfig,
  LOCALES,
  peopleByIds,
  personRef,
} from './support';

type CreateData = z.output<typeof createReviewSchema>;
type ListQuery = z.output<typeof reviewQuerySchema>;
type ItemQuery = z.output<typeof reviewItemQuerySchema>;
type DecideData = z.output<typeof decideItemSchema>;
type AddItemData = z.output<typeof addReviewItemSchema>;

export const REVIEW_ENTITY = 'isms.review';
export const reviewHref = (reference: string) => `/isms/reviews/${reference}`;
const label = (r: ReviewRow) => `${formatRef('review', r.number)} ${r.target}`;
const TICKET_TOOL = 'itsm.create_ticket';

/** Who may read the role holders of a core application (the same rule as the Role Query API). */
function canReadApplication(auth: AuthContext, appId: string) {
  const res = { recordType: 'application', recordId: appId };
  return auth.can('core.role-query.read', res) || auth.can('core.applications.read', res);
}

export class ReviewService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── reads ───────────── */

  async row(ref: string, db: Db = this.db): Promise<ReviewRow> {
    const n = isUuid(ref) ? null : parseRef('review', ref);
    const [row] = await db
      .select()
      .from(reviews)
      .where(isUuid(ref) ? eq(reviews.id, ref) : eq(reviews.number, n ?? -1));
    if (!row) throw httpErrors.notFound('Account review not found');
    return row;
  }

  async readable(ref: string, auth: AuthContext) {
    const row = await this.row(ref);
    if (!canReadReview(auth, row)) {
      if (!auth.can(P.self)) auth.require(P.reviewsRead);
      throw httpErrors.notFound('Account review not found');
    }
    return row;
  }

  private async progressOf(ids: readonly string[]) {
    const out = new Map<string, ReturnType<typeof reviewProgress>>();
    if (!ids.length) return out;
    const rows = await this.db
      .select({ id: reviewItems.reviewId, decision: reviewItems.decision, doneOn: reviewItems.doneOn })
      .from(reviewItems)
      .where(inArray(reviewItems.reviewId, [...ids]));
    for (const id of ids) out.set(id, reviewProgress(rows.filter((r) => r.id === id)));
    return out;
  }

  private async dtos(rows: ReviewRow[]) {
    const [progress, people, apps] = await Promise.all([
      this.progressOf(rows.map((r) => r.id)),
      peopleByIds(
        this.db,
        rows.flatMap((r) => [r.reviewerId, r.createdBy, r.completedBy, r.signedOffBy]),
      ),
      this.appsByIds(rows.map((r) => r.applicationId)),
    ]);
    const today = companyToday();
    const p = (id: string | null) => personRef(id ? people.get(id) : null);
    return rows.map((r) => ({
      id: r.id,
      reference: formatRef('review', r.number),
      target: r.target,
      targetRef: r.targetRef,
      reviewer: p(r.reviewerId),
      startOn: r.startOn,
      dueOn: r.dueOn,
      overdue: r.status === 'open' && r.dueOn < today,
      recurrence: r.recurrence,
      status: r.status,
      source: r.source,
      application: r.applicationId ? (apps.get(r.applicationId) ?? null) : null,
      progress: progress.get(r.id) ?? reviewProgress([]),
      createdBy: p(r.createdBy),
      completedBy: p(r.completedBy),
      completedAt: r.completedAt,
      signedOffBy: p(r.signedOffBy),
      signedOffAt: r.signedOffAt,
      signOffNote: r.signOffNote,
      createdAt: r.createdAt,
    }));
  }

  private async appsByIds(ids: readonly (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!wanted.length) return new Map<string, { id: string; key: string; name: string }>();
    const rows = await this.db
      .select({ id: applications.id, key: applications.key, name: applications.name })
      .from(applications)
      .where(inArray(applications.id, wanted));
    return new Map(rows.map((a) => [a.id, a]));
  }

  async list(q: ListQuery, auth: AuthContext) {
    const all = canReadAllReviews(auth);
    if (!all) auth.require(P.self);
    const where = and(
      q.status ? eq(reviews.status, q.status) : undefined,
      q.q ? ilike(reviews.target, likePattern(q.q)) : undefined,
      q.mine || !all ? (auth.user ? eq(reviews.reviewerId, auth.user.id) : sql`false`) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'createdAt';
    const column =
      key === 'dueOn'
        ? reviews.dueOn
        : key === 'target'
          ? reviews.target
          : key === 'number'
            ? reviews.number
            : reviews.createdAt;
    const dir = q.sort ? (q.sort.startsWith('-') ? desc : asc) : desc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(reviews)
        .where(where)
        .orderBy(dir(column), desc(reviews.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(reviews).where(where),
    ]);
    return { items: await this.dtos(rows), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async detail(ref: string, auth: AuthContext) {
    const row = await this.readable(ref, auth);
    const [dto] = await this.dtos([row]);
    const open = row.status === 'open';
    const tickets =
      this.ctx.ai.tools.list(auth).some((t) => t.name === TICKET_TOOL) && canDecideReview(auth, row);
    return {
      ...dto!,
      viewer: {
        canDecide: open && canDecideReview(auth, row),
        canManage: canManageReviews(auth),
        canSignOff: row.status === 'completed' && canSignOffReviews(auth),
        canRaiseTickets: tickets && row.status !== 'cancelled' && row.status !== 'scheduled',
      },
    };
  }

  private async itemDtos(rows: ReviewItemRow[]) {
    const people = await peopleByIds(
      this.db,
      rows.flatMap((i) => [i.userId, i.decidedBy]),
    );
    return rows.map((i) => ({
      id: i.id,
      accountName: i.accountName,
      userName: i.userName,
      user: personRef(i.userId ? people.get(i.userId) : null),
      privilege: i.privilege,
      accountStatus: i.accountStatus,
      detail: i.detail,
      decision: i.decision,
      doneOn: i.doneOn,
      note: i.note,
      ticket: i.ticketId
        ? { id: i.ticketId, reference: i.ticketRef ?? i.ticketId, href: i.ticketHref }
        : null,
      decidedBy: personRef(i.decidedBy ? people.get(i.decidedBy) : null),
      decidedAt: i.decidedAt,
    }));
  }

  async items(ref: string, q: ItemQuery, auth: AuthContext) {
    const row = await this.readable(ref, auth);
    const where = and(
      eq(reviewItems.reviewId, row.id),
      q.view === 'undecided'
        ? or(isNull(reviewItems.decision), and(ne(reviewItems.decision, 'keep'), isNull(reviewItems.doneOn)))
        : q.view === 'admin'
          ? eq(reviewItems.privilege, 'admin')
          : (REVIEW_DECISIONS as readonly string[]).includes(q.view)
            ? eq(reviewItems.decision, q.view as ReviewDecision)
            : undefined,
      q.q
        ? or(ilike(reviewItems.accountName, likePattern(q.q)), ilike(reviewItems.userName, likePattern(q.q)))
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(reviewItems)
        .where(where)
        .orderBy(asc(reviewItems.sortOrder), asc(reviewItems.accountName))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(reviewItems).where(where),
    ]);
    return { items: await this.itemDtos(rows), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  /** Core applications whose role holders the caller may read (to fill a review from). */
  async applications(auth: AuthContext) {
    auth.require(P.reviewsManage);
    const rows = await this.db
      .select({ id: applications.id, key: applications.key, name: applications.name })
      .from(applications)
      .orderBy(asc(applications.name));
    return {
      items: rows
        .filter((a) => canReadApplication(auth, a.id))
        .map((a) => ({ id: a.id, key: a.key, name: a.name })),
    };
  }

  /* ───────────── mutations ───────────── */

  private async audit(tx: Db, action: string, r: ReviewRow, metadata?: Record<string, unknown>) {
    await this.ctx.audit.record(
      { action, entityType: REVIEW_ENTITY, entityId: r.id, entityLabel: label(r), metadata },
      { tx },
    );
  }

  private ref(r: ReviewRow) {
    return { reviewId: r.id, reference: formatRef('review', r.number), target: r.target };
  }

  async create(input: CreateData, auth: AuthContext) {
    auth.require(P.reviewsManage);
    await activePeople(this.db, [input.reviewerId], 'reviewerId');
    const today = companyToday();
    const startOn = input.startOn && input.startOn > today ? input.startOn : today;
    if (input.dueOn < startOn)
      throw invalidField('dueOn', 'The due date is before the start', 'dueBeforeStart');
    if (input.targetRef) {
      const parsed = parseRecordRef(input.targetRef);
      if (!parsed || !(await this.ctx.records.get({ type: parsed.type, id: parsed.id }, auth)))
        throw invalidField('targetRef', 'Pick a record you can see', 'record');
    }
    if (input.applicationId) {
      const [app] = await this.db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.id, input.applicationId));
      if (!app || !canReadApplication(auth, app.id))
        throw invalidField(
          'applicationId',
          'Choose an application whose roles you can see',
          'unknownApplication',
        );
    }
    const open = startOn <= today;
    const row = await this.ctx.transaction(async (tx) => {
      const [r] = await tx
        .insert(reviews)
        .values({
          target: input.target,
          targetRef: input.targetRef ?? null,
          reviewerId: input.reviewerId,
          startOn,
          dueOn: input.dueOn,
          status: open ? 'open' : 'scheduled',
          source: input.applicationId ? 'application' : 'manual',
          applicationId: input.applicationId ?? null,
          recurrence: input.recurrence,
          createdBy: actingUserId(auth),
        })
        .returning();
      await this.audit(tx, 'isms.review.created', r!, {
        reviewerId: r!.reviewerId,
        startOn,
        dueOn: r!.dueOn,
        applicationId: r!.applicationId,
        recurrence: r!.recurrence,
      });
      await this.ctx.events.publish(
        'isms.review.created',
        {
          ...this.ref(r!),
          reviewerId: input.reviewerId,
          dueOn: r!.dueOn,
          status: open ? 'open' : 'scheduled',
        },
        { tx },
      );
      if (open) await this.start(tx, r!);
      return r!;
    });
    return this.detail(row.id, auth);
  }

  /**
   * Opens a review: fills it from the application's role holders (application reviews) or carries over the accounts
   * the previous review kept (other recurring reviews; the reviewer re-imports a fresh list when they have one),
   * then tells the reviewer.
   */
  async start(tx: Db, r: ReviewRow) {
    let items = 0;
    if (r.source === 'application' && r.applicationId) items = await this.fillFromApplication(tx, r);
    else if (r.previousId) {
      const previous = await tx
        .select()
        .from(reviewItems)
        .where(
          and(
            eq(reviewItems.reviewId, r.previousId),
            or(isNull(reviewItems.decision), ne(reviewItems.decision, 'delete')),
          ),
        )
        .orderBy(asc(reviewItems.sortOrder), asc(reviewItems.accountName));
      if (previous.length)
        await tx.insert(reviewItems).values(
          previous.map((p, i) => ({
            reviewId: r.id,
            accountName: p.accountName,
            userName: p.userName,
            userId: p.userId,
            privilege: p.privilege,
            accountStatus: p.decision === 'disable' ? ('disabled' as const) : p.accountStatus,
            detail: p.detail,
            sortOrder: i,
          })),
        );
      items = previous.length;
    }
    if (r.status !== 'open') await tx.update(reviews).set({ status: 'open' }).where(eq(reviews.id, r.id));
    await this.audit(tx, 'isms.review.started', r, { items });
    await this.ctx.events.publish(
      'isms.review.started',
      { ...this.ref(r), reviewerId: r.reviewerId, items, dueOn: r.dueOn },
      { tx },
    );
    const reference = formatRef('review', r.number);
    await this.ctx.notifications.notify(
      {
        type: 'isms.review.assigned',
        recipients: [r.reviewerId],
        params: { target: r.target, reference, due: r.dueOn, count: items },
        href: reviewHref(reference),
      },
      { tx },
    );
  }

  /** One item per active person holding a role in the application (privileged when a role reads so). */
  private async fillFromApplication(tx: Db, r: ReviewRow): Promise<number> {
    const res = await tx.execute<{
      id: string;
      username: string;
      display_name: string;
      role_key: string;
      role_name: string;
      risk_level: string;
    }>(sql`
      select distinct u.id, u.username, u.display_name, ro.key as role_key, ro.name as role_name, ro.risk_level
        from core.role_assignments ra
        join core.roles ro on ro.id = ra.role_id and ro.application_id = ${r.applicationId}
        left join core.group_members gm on gm.group_id = ra.group_id
        join core.users u on u.id = coalesce(ra.user_id, gm.user_id) and u.status = 'active'
       where ra.expires_at is null or ra.expires_at > now()
       order by u.display_name, ro.name
       limit 5000`);
    const byUser = new Map<
      string,
      { username: string; name: string; roles: { key: string; name: string; riskLevel: string }[] }
    >();
    for (const row of res.rows) {
      const u = byUser.get(row.id) ?? { username: row.username, name: row.display_name, roles: [] };
      if (!u.roles.some((x) => x.key === row.role_key))
        u.roles.push({ key: row.role_key, name: row.role_name, riskLevel: row.risk_level });
      byUser.set(row.id, u);
    }
    const values = [...byUser.entries()].map(([userId, u], i) => ({
      reviewId: r.id,
      accountName: u.username,
      userName: u.name,
      userId,
      privilege: privilegeOfRoles(u.roles),
      accountStatus: 'enabled' as const,
      detail: u.roles
        .map((x) => x.name)
        .join(', ')
        .slice(0, 500),
      sortOrder: i,
    }));
    for (let i = 0; i < values.length; i += 500)
      await tx
        .insert(reviewItems)
        .values(values.slice(i, i + 500))
        .onConflictDoNothing();
    return values.length;
  }

  private async openForChanges(ref: string, auth: AuthContext) {
    const row = await this.readable(ref, auth);
    if (!canDecideReview(auth, row)) auth.require(P.reviewsManage);
    if (row.status !== 'open') throw invalidState('The review is not open', 'reviewClosed');
    return row;
  }

  async addItem(ref: string, input: AddItemData, auth: AuthContext) {
    const row = await this.openForChanges(ref, auth);
    if (input.userId) await activePeople(this.db, [input.userId], 'userId');
    const [{ max }] = (await this.db
      .select({ max: sql<number>`coalesce(max(${reviewItems.sortOrder}), 0)` })
      .from(reviewItems)
      .where(eq(reviewItems.reviewId, row.id))) as [{ max: number }];
    const [item] = await this.ctx.transaction(async (tx) => {
      const inserted = await tx
        .insert(reviewItems)
        .values({
          reviewId: row.id,
          accountName: input.accountName,
          userName: input.userName ?? null,
          userId: input.userId ?? null,
          privilege: input.privilege,
          accountStatus: input.accountStatus,
          sortOrder: Number(max) + 1,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length)
        throw invalidField('accountName', 'The review already lists this account', 'duplicate');
      await this.audit(tx, 'isms.review.items_imported', row, { added: 1, accountName: input.accountName });
      await this.ctx.events.publish(
        'isms.review.items_imported',
        { ...this.ref(row), added: 1, updated: 0 },
        { tx },
      );
      return inserted;
    });
    return (await this.itemDtos([item!]))[0]!;
  }

  /**
   * Imports the system's account list (account, user, privilege, status; decision, date and note when the file has
   * them) into an open review: accounts already listed are updated, others added. People are matched by user name
   * (account = username, or the user column = email, username or a unique display name).
   */
  async importItems(ref: string, csv: string, dryRun: boolean, auth: AuthContext) {
    const row = await this.openForChanges(ref, auth);
    const aliases = Object.fromEntries(
      REVIEW_COLUMNS.map((c) => [c, [c, ...LOCALES.map((l) => CATALOGS[l].csv.review[c])]]),
    ) as Record<ReviewColumn, string[]>;
    aliases.account.push('username', 'login', 'account name', 'user id');
    aliases.user.push('name', 'display name', 'full name', 'owner');
    aliases.privilege.push('role', 'permission', 'access');
    aliases.status.push('state', 'enabled');
    const report = {
      dryRun,
      error: null as 'empty' | 'tooManyRows' | 'missingColumns' | null,
      missing: [] as string[],
      rows: 0,
      added: 0,
      updated: 0,
      matched: 0,
      skipped: 0,
      issues: [] as {
        line: number;
        column: string | null;
        code: 'required' | 'badPrivilege' | 'badStatus' | 'duplicate' | 'tooLong';
        value: string | null;
      }[],
    };
    const table = readCsvTable(csv, aliases, ['account'], REVIEW_IMPORT_MAX_ROWS);
    if (!table.ok) {
      report.error = table.error;
      if (table.error === 'missingColumns') report.missing = table.missing;
      return report;
    }
    report.rows = table.rows.length;
    const existing = await this.db.select().from(reviewItems).where(eq(reviewItems.reviewId, row.id));
    const byAccount = new Map(existing.map((i) => [i.accountName.toLowerCase(), i]));
    const decisionOf = (v: string): ReviewDecision | null =>
      (REVIEW_DECISIONS as readonly string[]).includes(v.toLowerCase())
        ? (v.toLowerCase() as ReviewDecision)
        : (REVIEW_DECISIONS.find((d) =>
            LOCALES.some((l) => normalizeName(CATALOGS[l].reviewDecision[d]) === normalizeName(v)),
          ) ?? null);
    const seen = new Set<string>();
    const planned: {
      line: number;
      key: string;
      accountName: string;
      userName: string | null;
      privilege: 'admin' | 'user' | null;
      accountStatus: 'enabled' | 'disabled' | null;
      decision: ReviewDecision | null;
      doneOn: string | null;
      note: string | null;
    }[] = [];
    for (const { line, values: v } of table.rows) {
      const issue = (column: string | null, code: (typeof report.issues)[number]['code'], value?: string) =>
        report.issues.push({ line, column, code, value: value ?? null });
      const before = report.issues.length;
      const account = v.account;
      if (!account) issue('account', 'required');
      else if (account.length > 200) issue('account', 'tooLong', account.slice(0, 40));
      else if (seen.has(account.toLowerCase())) issue('account', 'duplicate', account);
      if ((v.user?.length ?? 0) > 200) issue('user', 'tooLong', v.user!.slice(0, 40));
      const privilege = v.privilege ? parsePrivilege(v.privilege) : null;
      if (v.privilege && !privilege) issue('privilege', 'badPrivilege', v.privilege);
      const accountStatus = v.status ? parseAccountState(v.status) : null;
      if (v.status && !accountStatus) issue('status', 'badStatus', v.status);
      if (report.issues.length > before) {
        report.skipped++;
        continue;
      }
      seen.add(account!.toLowerCase());
      planned.push({
        line,
        key: account!.toLowerCase(),
        accountName: account!,
        userName: v.user ?? null,
        privilege,
        accountStatus,
        decision: v.decision ? decisionOf(v.decision) : null,
        doneOn: v.doneOn ? parseLooseDate(v.doneOn) : null,
        note: v.note ? v.note.slice(0, 2000) : null,
      });
    }
    const matches = await this.matchPeople(
      planned.map((p) => ({ account: p.accountName, user: p.userName })),
    );
    report.matched = planned.filter((p) => matches.get(p.key)).length;
    for (const p of planned) if (byAccount.has(p.key)) report.updated++;
    report.added = planned.length - report.updated;
    if (dryRun) return report;
    await this.ctx.transaction(async (tx) => {
      let order = existing.reduce((m, i) => Math.max(m, i.sortOrder), 0);
      const now = new Date();
      for (const p of planned) {
        const current = byAccount.get(p.key);
        const userId = matches.get(p.key) ?? current?.userId ?? null;
        const decided = p.decision
          ? {
              decision: p.decision,
              doneOn: p.decision === 'keep' ? null : p.doneOn,
              decidedBy: actingUserId(auth),
              decidedAt: now,
            }
          : {};
        if (current)
          await tx
            .update(reviewItems)
            .set({
              ...(p.userName ? { userName: p.userName } : {}),
              userId,
              ...(p.privilege ? { privilege: p.privilege } : {}),
              ...(p.accountStatus ? { accountStatus: p.accountStatus } : {}),
              ...(p.note ? { note: p.note } : {}),
              ...decided,
            })
            .where(eq(reviewItems.id, current.id));
        else
          await tx.insert(reviewItems).values({
            reviewId: row.id,
            accountName: p.accountName,
            userName: p.userName,
            userId,
            privilege: p.privilege ?? 'user',
            accountStatus: p.accountStatus ?? 'enabled',
            note: p.note,
            sortOrder: ++order,
            ...decided,
          });
      }
      if (row.source === 'manual')
        await tx.update(reviews).set({ source: 'csv' }).where(eq(reviews.id, row.id));
      await this.audit(tx, 'isms.review.items_imported', row, {
        rows: report.rows,
        added: report.added,
        updated: report.updated,
        skipped: report.skipped,
      });
      await this.ctx.events.publish(
        'isms.review.items_imported',
        { ...this.ref(row), added: report.added, updated: report.updated },
        { tx },
      );
    });
    return report;
  }

  /** A person per row where one matches without doubt (keyed by lower-case account name). */
  private async matchPeople(rows: { account: string; user: string | null }[]) {
    const out = new Map<string, string>();
    if (!rows.length) return out;
    const names = [
      ...new Set(
        rows.flatMap((r) => [r.account, r.user].filter((x): x is string => Boolean(x)).map(normalizeName)),
      ),
    ];
    const people: { id: string; username: string; email: string; displayName: string }[] = [];
    for (let i = 0; i < names.length; i += 1000) {
      const chunk = names.slice(i, i + 1000);
      people.push(
        ...(await this.db
          .select({
            id: users.id,
            username: users.username,
            email: users.email,
            displayName: users.displayName,
          })
          .from(users)
          .where(
            or(
              inArray(sql`lower(${users.username})`, chunk),
              inArray(sql`lower(${users.email})`, chunk),
              inArray(sql`lower(${users.displayName})`, chunk),
            ),
          )),
      );
    }
    const unique = <T>(list: T[]) => (list.length === 1 ? list[0] : undefined);
    for (const r of rows) {
      const account = normalizeName(r.account);
      const user = r.user ? normalizeName(r.user) : null;
      const hit =
        unique(people.filter((p) => p.username.toLowerCase() === account)) ??
        (user
          ? (unique(
              people.filter((p) => p.email.toLowerCase() === user || p.username.toLowerCase() === user),
            ) ?? unique(people.filter((p) => normalizeName(p.displayName) === user)))
          : undefined);
      if (hit) out.set(r.account.toLowerCase(), hit.id);
    }
    return out;
  }

  async decide(ref: string, itemIds: readonly string[], input: DecideData, auth: AuthContext) {
    const row = await this.openForChanges(ref, auth);
    if (input.doneOn && input.doneOn > companyToday())
      throw invalidField('doneOn', 'The date is in the future', 'future');
    const items = await this.db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.reviewId, row.id), inArray(reviewItems.id, [...itemIds])));
    if (items.length !== new Set(itemIds).size) throw httpErrors.notFound('Item not found');
    await this.ctx.transaction(async (tx) => {
      for (const item of items) {
        const doneOn =
          input.decision === 'keep'
            ? null
            : input.doneOn === undefined
              ? item.doneOn
              : (input.doneOn ?? null);
        await tx
          .update(reviewItems)
          .set({
            decision: input.decision,
            doneOn,
            ...(input.note !== undefined ? { note: input.note } : {}),
            decidedBy: actingUserId(auth),
            decidedAt: new Date(),
          })
          .where(eq(reviewItems.id, item.id));
        await this.audit(tx, 'isms.review.item_decided', row, {
          itemId: item.id,
          accountName: item.accountName,
          decision: input.decision,
          doneOn,
          previous: item.decision,
        });
        await this.ctx.events.publish(
          'isms.review.item_decided',
          { ...this.ref(row), itemId: item.id, decision: input.decision, accountStatus: item.accountStatus },
          { tx },
        );
      }
    });
    const after = await this.db
      .select()
      .from(reviewItems)
      .where(
        inArray(
          reviewItems.id,
          items.map((i) => i.id),
        ),
      );
    return { items: await this.itemDtos(after) };
  }

  /** The reviewer is done: every item decided (disable and delete with the date). */
  async complete(ref: string, auth: AuthContext) {
    const row = await this.openForChanges(ref, auth);
    const items = await this.db
      .select({ decision: reviewItems.decision, doneOn: reviewItems.doneOn })
      .from(reviewItems)
      .where(eq(reviewItems.reviewId, row.id));
    if (!items.length) throw invalidState('The review has no accounts', 'reviewEmpty');
    const pending = items.filter((i) => !itemDecided(i)).length;
    if (pending) throw invalidState('Some accounts are not decided yet', 'itemsPending', { pending });
    const reference = formatRef('review', row.number);
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(reviews)
        .set({ status: 'completed', completedBy: actingUserId(auth), completedAt: new Date() })
        .where(eq(reviews.id, row.id));
      await this.audit(tx, 'isms.review.completed', row, reviewProgress(items));
      await this.ctx.events.publish('isms.review.completed', this.ref(row), { tx });
      await this.ctx.notifications.notify(
        {
          type: 'isms.review.ready',
          recipients: [row.createdBy],
          params: { target: row.target, reference },
          href: reviewHref(reference),
        },
        { tx },
      );
    });
    return this.detail(row.id, auth);
  }

  /** Sends a completed review back to the reviewer (instead of signing it off). */
  async reopen(ref: string, auth: AuthContext) {
    if (!canSignOffReviews(auth)) auth.require(P.reviewsManage);
    const row = await this.row(ref);
    if (row.status !== 'completed')
      throw invalidState('Only a completed review can be reopened', 'reviewNotCompleted');
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(reviews)
        .set({ status: 'open', completedAt: null, completedBy: null })
        .where(eq(reviews.id, row.id));
      await this.audit(tx, 'isms.review.reopened', row);
      await this.ctx.events.publish('isms.review.reopened', this.ref(row), { tx });
    });
    return this.detail(row.id, auth);
  }

  async signOff(ref: string, note: string | null | undefined, auth: AuthContext) {
    auth.require(P.reviewsSignoff);
    const row = await this.row(ref);
    if (row.status !== 'completed')
      throw invalidState('Only a completed review can be signed off', 'reviewNotCompleted');
    await this.ctx.transaction(async (tx) => {
      const [locked] = await tx.select().from(reviews).where(eq(reviews.id, row.id)).for('update');
      if (locked!.status !== 'completed')
        throw invalidState('Only a completed review can be signed off', 'reviewNotCompleted');
      await tx
        .update(reviews)
        .set({
          status: 'signed_off',
          signedOffBy: actingUserId(auth),
          signedOffAt: new Date(),
          signOffNote: note ?? null,
        })
        .where(eq(reviews.id, row.id));
      await this.audit(tx, 'isms.review.signed_off', row, { note: note ?? null });
      await this.ctx.events.publish('isms.review.signed_off', this.ref(row), { tx });
      const months = recurrenceMonths(row.recurrence);
      if (months) {
        const [next] = await tx
          .insert(reviews)
          .values({
            target: row.target,
            targetRef: row.targetRef,
            reviewerId: row.reviewerId,
            startOn: addMonths(row.startOn, months),
            dueOn: addMonths(row.dueOn, months),
            status: 'scheduled',
            source: row.source,
            applicationId: row.applicationId,
            recurrence: row.recurrence,
            previousId: row.id,
            createdBy: row.createdBy,
          })
          .onConflictDoNothing()
          .returning();
        if (next) {
          await this.audit(tx, 'isms.review.created', next, {
            previous: formatRef('review', row.number),
            startOn: next.startOn,
            dueOn: next.dueOn,
          });
          await this.ctx.events.publish(
            'isms.review.created',
            { ...this.ref(next), reviewerId: next.reviewerId, dueOn: next.dueOn, status: 'scheduled' },
            { tx },
          );
        }
      }
    });
    return this.detail(row.id, auth);
  }

  async cancel(ref: string, auth: AuthContext) {
    auth.require(P.reviewsManage);
    const row = await this.row(ref);
    if (row.status === 'signed_off' || row.status === 'cancelled')
      throw invalidState('The review is already closed', 'reviewClosed');
    await this.ctx.transaction(async (tx) => {
      await tx.update(reviews).set({ status: 'cancelled' }).where(eq(reviews.id, row.id));
      await this.audit(tx, 'isms.review.cancelled', row);
      await this.ctx.events.publish('isms.review.cancelled', this.ref(row), { tx });
    });
    return this.detail(row.id, auth);
  }

  /**
   * Raises one ITSM service request per disable or delete decision without a ticket, through ITSM's AI tool as the
   * caller (their ITSM permissions apply; each ticket is ITSM's own transaction), then records the ticket on the item.
   */
  async raiseTickets(ref: string, auth: AuthContext) {
    const row = await this.readable(ref, auth);
    if (!canDecideReview(auth, row)) auth.require(P.reviewsManage);
    if (row.status === 'cancelled' || row.status === 'scheduled')
      throw invalidState('The review is not active', 'reviewClosed');
    if (!this.ctx.ai.tools.list(auth).some((t) => t.name === TICKET_TOOL))
      throw invalidState('Raising tickets needs the service desk', 'ticketsUnavailable');
    const items = await this.db
      .select()
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.reviewId, row.id),
          inArray(reviewItems.decision, ['disable', 'delete']),
          isNull(reviewItems.ticketId),
        ),
      )
      .orderBy(asc(reviewItems.sortOrder));
    const reference = formatRef('review', row.number);
    // The ticket is written in the language of the person raising it.
    const locale = (LOCALES as readonly string[]).includes(auth.user?.locale ?? '')
      ? (auth.user!.locale as 'en')
      : 'en';
    const words = CATALOGS[locale].tickets;
    let raised = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const ticket = await this.ctx.ai.tools.invoke<{ id?: string; reference?: string; href?: string }>(
          TICKET_TOOL,
          {
            type: 'service_request',
            title:
              `${item.decision === 'delete' ? words.deleteTitle : words.disableTitle} ${item.accountName} (${row.target})`.slice(
                0,
                200,
              ),
            description: [
              `${words.review}: ${reference} — ${row.target}`,
              `${words.account}: ${item.accountName}${item.userName ? ` (${item.userName})` : ''}`,
              `${words.decision}: ${CATALOGS[locale].reviewDecision[item.decision!]}`,
              item.note ? `${words.note}: ${item.note}` : null,
              `${words.link}: ${reviewHref(reference)}`,
            ]
              .filter(Boolean)
              .join('\n'),
            channel: 'portal',
          },
          { auth },
        );
        if (!ticket?.id) {
          failed++;
          continue;
        }
        await this.ctx.transaction(async (tx) => {
          await tx
            .update(reviewItems)
            .set({
              ticketId: ticket.id!,
              ticketRef: ticket.reference ?? null,
              ticketHref: ticket.href ?? null,
            })
            .where(eq(reviewItems.id, item.id));
          await this.audit(tx, 'isms.review.ticket_raised', row, {
            itemId: item.id,
            accountName: item.accountName,
            ticket: ticket.reference ?? ticket.id,
          });
        });
        raised++;
      } catch (err) {
        this.ctx.logger.warn({ err, review: reference, item: item.id }, 'raising a ticket failed');
        failed++;
      }
    }
    return { raised, failed };
  }

  /** The review in the account-review layout: target and date, then account, user, privilege, status, decision, date, note. */
  async exportCsv(ref: string, auth: AuthContext, locale: string) {
    const row = await this.readable(ref, auth);
    const catalog = CATALOGS[(LOCALES as readonly string[]).includes(locale) ? (locale as 'en') : 'en'];
    const items = await this.db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.reviewId, row.id))
      .orderBy(asc(reviewItems.sortOrder), asc(reviewItems.accountName));
    const people = await peopleByIds(
      this.db,
      items.map((i) => i.userId),
    );
    const h = catalog.csv.review;
    const reference = formatRef('review', row.number);
    const csv = toCsv([
      [catalog.csv.reviewTarget, row.target],
      [catalog.csv.reviewDate, row.completedAt ? row.completedAt.toISOString().slice(0, 10) : companyToday()],
      [catalog.csv.reviewReference, reference],
      [],
      REVIEW_COLUMNS.map((c) => h[c]),
      ...items.map((i) => [
        i.accountName,
        i.userName ?? (i.userId ? people.get(i.userId)?.displayName : '') ?? '',
        catalog.privilege[i.privilege],
        catalog.accountState[i.accountStatus],
        i.decision ? catalog.reviewDecision[i.decision] : '',
        i.doneOn ?? '',
        i.note ?? '',
      ]),
    ]);
    await this.ctx.audit.record({
      action: 'isms.review.exported',
      entityType: REVIEW_ENTITY,
      entityId: row.id,
      entityLabel: label(row),
      metadata: { rows: items.length },
    });
    return { filename: `${reference}.csv`, csv };
  }

  /* ───────────── schedule & dashboard ───────────── */

  /** Daily: opens scheduled reviews on their start date; reminds reviewers before the due date and once it passed. */
  async daily(log: (m: string) => void = () => undefined) {
    const today = companyToday();
    const cfg = await ismsConfig(this.ctx);
    let started = 0;
    let reminded = 0;
    let overdue = 0;
    const scheduled = await this.db
      .select()
      .from(reviews)
      .where(and(eq(reviews.status, 'scheduled'), lte(reviews.startOn, today)));
    for (const r of scheduled)
      await this.ctx.transaction(async (tx) => {
        const [locked] = await tx.select().from(reviews).where(eq(reviews.id, r.id)).for('update');
        if (locked?.status !== 'scheduled') return;
        await this.start(tx, locked);
        started++;
      });
    const open = await this.db.select().from(reviews).where(eq(reviews.status, 'open'));
    for (const r of open) {
      const soon = r.dueOn >= today && daysBetween(today, r.dueOn) <= cfg.reminderDays && !r.remindedOn;
      const late = r.dueOn < today && !r.overdueNotifiedOn;
      if (!soon && !late) continue;
      const reference = formatRef('review', r.number);
      await this.ctx.transaction(async (tx) => {
        await this.ctx.notifications.notify(
          {
            type: late ? 'isms.review.overdue' : 'isms.review.reminder',
            recipients: late ? [r.reviewerId, r.createdBy] : [r.reviewerId],
            params: { target: r.target, reference, due: r.dueOn },
            href: reviewHref(reference),
          },
          { tx },
        );
        await tx
          .update(reviews)
          .set(late ? { overdueNotifiedOn: today, remindedOn: r.remindedOn ?? today } : { remindedOn: today })
          .where(eq(reviews.id, r.id));
      });
      if (late) overdue++;
      else reminded++;
    }
    log(`account reviews: ${started} started, ${reminded} reminded, ${overdue} overdue`);
    return { started, reminded, overdue };
  }

  /** Reviews in progress the caller may see (dashboard). */
  async inProgress(auth: AuthContext) {
    if (!canReadAllReviews(auth) && !auth.can(P.self)) return [];
    const all = canReadAllReviews(auth);
    const rows = await this.db
      .select()
      .from(reviews)
      .where(
        and(
          inArray(reviews.status, ['open', 'completed']),
          all ? undefined : auth.user ? eq(reviews.reviewerId, auth.user.id) : sql`false`,
        ),
      )
      .orderBy(asc(reviews.dueOn))
      .limit(5);
    return (await this.dtos(rows)).map((r) => ({
      id: r.id,
      reference: r.reference,
      target: r.target,
      dueOn: r.dueOn,
      percent: r.progress.percent,
      status: r.status,
    }));
  }
}
