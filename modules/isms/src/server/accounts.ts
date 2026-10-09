/**
 * Shared accounts: an account several people use on one system, with a custodian who keeps the password and the
 * list of people allowed to use it. When a member leaves, moves to another department or is taken off the list, the
 * password must be changed that day: the account shows "password change due" and the custodian is told (security
 * officers when the custodian is the one who left) until they record the change. A yearly review confirms the
 * members. Event handlers and the process action are idempotent (`account_events.dedupe_key`).
 */
import { departments } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  httpErrors,
  likePattern,
  type ModuleContext,
  parseRecordRef,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  accountQuerySchema,
  createSharedAccountSchema,
  passwordChangedSchema,
  reviewAccountSchema,
  updateSharedAccountSchema,
} from '../contracts';
import { addMonths, formatRef, isUuid, parseRef, type PasswordReason } from '../model';
import {
  canManageAccounts,
  canReadAccount,
  canReadAllAccounts,
  canTendAccount,
  isCustodian,
  P,
} from './access';
import {
  type AccountEventKind,
  accountEvents,
  accountMembers,
  type SharedAccountRow,
  sharedAccounts,
} from './schema';
import {
  type Actor,
  actingUserId,
  activePeople,
  actorOf,
  companyToday,
  departmentsByIds,
  invalidField,
  invalidState,
  ismsConfig,
  peopleByIds,
  personRef,
  pgCode,
  roleHolders,
  UNIQUE_VIOLATION,
} from './support';

type CreateData = z.output<typeof createSharedAccountSchema>;
type UpdateData = z.output<typeof updateSharedAccountSchema>;
type ListQuery = z.output<typeof accountQuerySchema>;
type PasswordData = z.output<typeof passwordChangedSchema>;
type ReviewData = z.output<typeof reviewAccountSchema>;

export const ACCOUNT_ENTITY = 'isms.account';
export const accountHref = (reference: string) => `/isms/accounts/${reference}`;
const label = (a: SharedAccountRow) => `${formatRef('account', a.number)} ${a.accountName}`;

/** Security officers and administrators: told about accounts whose custodian left. */
const OFFICER_ROLES = ['isms-security-officer', 'isms-admin'];

export class SharedAccountService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── reads ───────────── */

  async row(ref: string, db: Db = this.db): Promise<SharedAccountRow> {
    const n = isUuid(ref) ? null : parseRef('account', ref);
    const [row] = await db
      .select()
      .from(sharedAccounts)
      .where(isUuid(ref) ? eq(sharedAccounts.id, ref) : eq(sharedAccounts.number, n ?? -1));
    if (!row) throw httpErrors.notFound('Shared account not found');
    return row;
  }

  async memberIds(accountId: string, db: Db = this.db): Promise<string[]> {
    const rows = await db
      .select({ userId: accountMembers.userId })
      .from(accountMembers)
      .where(eq(accountMembers.accountId, accountId));
    return rows.map((r) => r.userId);
  }

  async readable(ref: string, auth: AuthContext) {
    const row = await this.row(ref);
    const members = await this.memberIds(row.id);
    if (!canReadAccount(auth, row, members)) {
      if (!auth.can(P.self)) auth.require(P.accountsRead);
      throw httpErrors.notFound('Shared account not found');
    }
    return { row, members };
  }

  /** The caller's own accounts: custodian or member. */
  private mine(userId: string | null): SQL {
    if (!userId) return sql`false`;
    return or(
      eq(sharedAccounts.custodianId, userId),
      inArray(
        sharedAccounts.id,
        this.db
          .select({ id: accountMembers.accountId })
          .from(accountMembers)
          .where(eq(accountMembers.userId, userId)),
      ),
    )!;
  }

  private async dtos(rows: SharedAccountRow[]) {
    const ids = rows.map((r) => r.id);
    const [counts, people, depts] = await Promise.all([
      ids.length
        ? this.db
            .select({ id: accountMembers.accountId, n: count() })
            .from(accountMembers)
            .where(inArray(accountMembers.accountId, ids))
            .groupBy(accountMembers.accountId)
        : [],
      peopleByIds(
        this.db,
        rows.flatMap((r) => [r.custodianId, r.passwordDueUserId, r.lastReviewedBy]),
      ),
      departmentsByIds(
        this.db,
        rows.map((r) => r.departmentId),
      ),
    ]);
    const n = new Map(counts.map((c) => [c.id, c.n]));
    const today = companyToday();
    return rows.map((a) => ({
      id: a.id,
      reference: formatRef('account', a.number),
      accountName: a.accountName,
      targetSystem: a.targetSystem,
      targetRef: a.targetRef,
      custodian: personRef(a.custodianId ? people.get(a.custodianId) : null),
      department: a.departmentId ? (depts.get(a.departmentId) ?? null) : null,
      purpose: a.purpose,
      project: a.project,
      requestReference: a.requestReference,
      lastPasswordChangeOn: a.lastPasswordChangeOn,
      passwordChange: {
        due: a.passwordDueSince !== null,
        since: a.passwordDueSince,
        reason: a.passwordDueReason,
        member: personRef(a.passwordDueUserId ? people.get(a.passwordDueUserId) : null),
      },
      status: a.status,
      nextReviewOn: a.nextReviewOn,
      reviewDue: a.status === 'active' && a.nextReviewOn !== null && a.nextReviewOn <= today,
      lastReviewedOn: a.lastReviewedOn,
      lastReviewedBy: personRef(a.lastReviewedBy ? people.get(a.lastReviewedBy) : null),
      notes: a.notes,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      memberCount: n.get(a.id) ?? 0,
    }));
  }

  async list(q: ListQuery, auth: AuthContext) {
    const all = canReadAllAccounts(auth);
    if (!all) auth.require(P.self);
    const today = companyToday();
    const where = and(
      q.view === 'active'
        ? eq(sharedAccounts.status, 'active')
        : q.view === 'retired'
          ? eq(sharedAccounts.status, 'retired')
          : q.view === 'password'
            ? and(eq(sharedAccounts.status, 'active'), isNotNull(sharedAccounts.passwordDueSince))
            : q.view === 'review'
              ? and(eq(sharedAccounts.status, 'active'), lte(sharedAccounts.nextReviewOn, today))
              : undefined,
      q.q
        ? or(
            ilike(sharedAccounts.accountName, likePattern(q.q)),
            ilike(sharedAccounts.targetSystem, likePattern(q.q)),
            ilike(sharedAccounts.project, likePattern(q.q)),
          )
        : undefined,
      q.custodian ? eq(sharedAccounts.custodianId, q.custodian) : undefined,
      q.mine || !all ? this.mine(auth.user?.id ?? null) : undefined,
    );
    const sortKey = q.sort?.replace(/^-/, '') ?? 'accountName';
    const column =
      sortKey === 'nextReviewOn'
        ? sharedAccounts.nextReviewOn
        : sortKey === 'lastPasswordChangeOn'
          ? sharedAccounts.lastPasswordChangeOn
          : sortKey === 'number'
            ? sharedAccounts.number
            : sortKey === 'targetSystem'
              ? sharedAccounts.targetSystem
              : sharedAccounts.accountName;
    const dir = q.sort?.startsWith('-') ? desc : asc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(sharedAccounts)
        .where(where)
        .orderBy(dir(column), asc(sharedAccounts.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(sharedAccounts).where(where),
    ]);
    return { items: await this.dtos(rows), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async detail(ref: string, auth: AuthContext) {
    const { row } = await this.readable(ref, auth);
    const [dto] = await this.dtos([row]);
    const members = await this.db
      .select()
      .from(accountMembers)
      .where(eq(accountMembers.accountId, row.id))
      .orderBy(asc(accountMembers.addedAt));
    const people = await peopleByIds(
      this.db,
      members.map((m) => m.userId),
    );
    const { memberCount: _n, ...rest } = dto!;
    return {
      ...rest,
      members: members
        .map((m) => ({
          user: personRef(people.get(m.userId))!,
          addedAt: m.addedAt,
          active: people.get(m.userId)?.status === 'active',
        }))
        .filter((m) => m.user)
        .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName)),
      viewer: {
        canManage: canManageAccounts(auth),
        isCustodian: isCustodian(auth, row),
        canRecordPassword: canTendAccount(auth, row) && row.status === 'active',
      },
    };
  }

  async events(ref: string, q: { page: number; pageSize: number }, auth: AuthContext) {
    const { row } = await this.readable(ref, auth);
    const where = eq(accountEvents.accountId, row.id);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(accountEvents)
        .where(where)
        .orderBy(desc(accountEvents.createdAt), desc(accountEvents.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(accountEvents).where(where),
    ]);
    const people = await peopleByIds(
      this.db,
      rows.flatMap((e) => [e.userId, e.actorId]),
    );
    return {
      items: rows.map((e) => {
        const actor = e.actorId ? people.get(e.actorId) : undefined;
        return {
          id: e.id,
          kind: e.kind,
          user: personRef(e.userId ? people.get(e.userId) : null),
          note: e.note,
          data: e.data ?? null,
          actor: actor
            ? { id: actor.id, displayName: actor.displayName }
            : e.actorName
              ? { id: null, displayName: e.actorName }
              : null,
          createdAt: e.createdAt,
        };
      }),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /* ───────────── history, audit, events ───────────── */

  /** A history entry; false when its `dedupeKey` was already recorded (a repeated event or run). */
  private async event(
    tx: Db,
    accountId: string,
    kind: AccountEventKind,
    actor: Actor,
    data: {
      userId?: string | null;
      note?: string | null;
      data?: Record<string, unknown>;
      dedupeKey?: string;
    } = {},
  ): Promise<boolean> {
    const rows = await tx
      .insert(accountEvents)
      .values({
        accountId,
        kind,
        userId: data.userId ?? null,
        note: data.note ?? null,
        data: data.data ?? null,
        dedupeKey: data.dedupeKey ?? null,
        actorId: actor.actorId,
        actorName: actor.actorName,
      })
      .onConflictDoNothing()
      .returning({ id: accountEvents.id });
    return rows.length > 0;
  }

  private ref(a: SharedAccountRow) {
    return { accountId: a.id, reference: formatRef('account', a.number), accountName: a.accountName };
  }

  private async checkTarget(targetRef: string | null | undefined, auth: AuthContext) {
    if (!targetRef) return;
    const parsed = parseRecordRef(targetRef);
    if (!parsed) throw invalidField('targetRef', 'Pick a record', 'record');
    // People must be able to read what they point at; system work (a process action) passes on what the request's
    // record field already checked.
    if (auth.user && !(await this.ctx.records.get({ type: parsed.type, id: parsed.id }, auth)))
      throw invalidField('targetRef', 'Pick a record you can see', 'record');
  }

  private async checkDepartment(id: string | null | undefined) {
    if (!id) return;
    const [d] = await this.db.select({ id: departments.id }).from(departments).where(eq(departments.id, id));
    if (!d) throw invalidField('departmentId', 'Unknown department');
  }

  /* ───────────── mutations ───────────── */

  async create(
    input: CreateData,
    auth: AuthContext,
    opts: { tx?: Db; dedupeKey?: string; note?: string } = {},
  ): Promise<SharedAccountRow> {
    auth.require(P.accountsManage);
    await activePeople(this.db, [input.custodianId], 'custodianId');
    await activePeople(this.db, input.memberIds, 'memberIds');
    await this.checkTarget(input.targetRef, auth);
    await this.checkDepartment(input.departmentId);
    const cfg = await ismsConfig(this.ctx);
    const work = async (tx: Db) => {
      const [row] = await tx
        .insert(sharedAccounts)
        .values({
          accountName: input.accountName,
          targetSystem: input.targetSystem ?? null,
          targetRef: input.targetRef ?? null,
          custodianId: input.custodianId,
          departmentId: input.departmentId ?? null,
          purpose: input.purpose ?? null,
          project: input.project ?? null,
          requestReference: input.requestReference ?? null,
          lastPasswordChangeOn: input.lastPasswordChangeOn ?? null,
          nextReviewOn: input.nextReviewOn ?? addMonths(companyToday(), cfg.reviewMonths),
          notes: input.notes ?? null,
          createdBy: actingUserId(auth),
        })
        .returning();
      const a = row!;
      const members = [...new Set(input.memberIds)];
      if (members.length)
        await tx
          .insert(accountMembers)
          .values(members.map((userId) => ({ accountId: a.id, userId, addedBy: actingUserId(auth) })));
      await this.event(tx, a.id, 'created', actorOf(auth), {
        note: opts.note ?? null,
        data: { members: members.length },
        dedupeKey: opts.dedupeKey,
      });
      await this.ctx.audit.record(
        {
          action: 'isms.account.created',
          entityType: ACCOUNT_ENTITY,
          entityId: a.id,
          entityLabel: label(a),
          metadata: {
            targetSystem: a.targetSystem,
            custodianId: a.custodianId,
            members,
            ...(a.requestReference ? { request: a.requestReference } : {}),
          },
        },
        { tx },
      );
      await this.ctx.events.publish('isms.account.created', this.ref(a), { tx });
      return a;
    };
    return opts.tx ? work(opts.tx) : this.ctx.transaction(work);
  }

  async update(ref: string, input: UpdateData, auth: AuthContext, opts: { tx?: Db } = {}) {
    auth.require(P.accountsManage);
    const before = await this.row(ref, opts.tx ?? this.db);
    if (input.custodianId && input.custodianId !== before.custodianId)
      await activePeople(this.db, [input.custodianId], 'custodianId');
    if (input.targetRef && input.targetRef !== before.targetRef)
      await this.checkTarget(input.targetRef, auth);
    if (input.departmentId) await this.checkDepartment(input.departmentId);
    const currentMembers = await this.memberIds(before.id, opts.tx ?? this.db);
    const nextMembers = input.memberIds ? [...new Set(input.memberIds)] : currentMembers;
    const added = nextMembers.filter((m) => !currentMembers.includes(m));
    const removed = currentMembers.filter((m) => !nextMembers.includes(m));
    if (added.length) await activePeople(this.db, added, 'memberIds');
    const patch: Partial<typeof sharedAccounts.$inferInsert> = {};
    const fields = [
      'accountName',
      'targetSystem',
      'targetRef',
      'custodianId',
      'departmentId',
      'purpose',
      'project',
      'requestReference',
      'nextReviewOn',
      'notes',
      'status',
    ] as const;
    for (const f of fields) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (!Object.keys(patch).length && !added.length && !removed.length) return before;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    const work = async (tx: Db) => {
      const [row] = Object.keys(patch).length
        ? await tx.update(sharedAccounts).set(patch).where(eq(sharedAccounts.id, before.id)).returning()
        : [before];
      const a = row!;
      const actor = actorOf(auth);
      if (Object.keys(patch).length) {
        const kind: AccountEventKind =
          patch.status === 'retired' ? 'retired' : patch.status === 'active' ? 'restored' : 'updated';
        await this.event(tx, a.id, kind, actor, { data: { changes: Object.keys(patch) } });
        await this.ctx.audit.record(
          {
            action: 'isms.account.updated',
            entityType: ACCOUNT_ENTITY,
            entityId: a.id,
            entityLabel: label(a),
            changes,
          },
          { tx },
        );
        await this.ctx.events.publish(
          'isms.account.updated',
          { ...this.ref(a), changes: Object.keys(patch) },
          { tx },
        );
      }
      for (const userId of added) await this.addMember(tx, a, userId, auth);
      for (const userId of removed) await this.dropMember(tx, a, userId, 'member_removed', auth);
      return a;
    };
    return opts.tx ? work(opts.tx) : this.ctx.transaction(work);
  }

  private async addMember(tx: Db, a: SharedAccountRow, userId: string, auth: AuthContext, note?: string) {
    const inserted = await tx
      .insert(accountMembers)
      .values({ accountId: a.id, userId, addedBy: actingUserId(auth) })
      .onConflictDoNothing()
      .returning({ userId: accountMembers.userId });
    if (!inserted.length) return;
    await this.event(tx, a.id, 'member_added', actorOf(auth), { userId, note: note ?? null });
    await this.ctx.audit.record(
      {
        action: 'isms.account.member_added',
        entityType: ACCOUNT_ENTITY,
        entityId: a.id,
        entityLabel: label(a),
        metadata: { userId },
      },
      { tx },
    );
    await this.ctx.events.publish('isms.account.member_added', { ...this.ref(a), userId }, { tx });
  }

  /** Takes someone off the list; the password becomes due. */
  private async dropMember(
    tx: Db,
    a: SharedAccountRow,
    userId: string,
    reason: PasswordReason,
    auth: AuthContext,
    dedupeKey?: string,
  ) {
    const deleted = await tx
      .delete(accountMembers)
      .where(and(eq(accountMembers.accountId, a.id), eq(accountMembers.userId, userId)))
      .returning({ userId: accountMembers.userId });
    if (!deleted.length) return false;
    await this.event(tx, a.id, 'member_removed', actorOf(auth), { userId, data: { reason } });
    await this.ctx.audit.record(
      {
        action: 'isms.account.member_removed',
        entityType: ACCOUNT_ENTITY,
        entityId: a.id,
        entityLabel: label(a),
        metadata: { userId, reason },
      },
      { tx },
    );
    await this.ctx.events.publish('isms.account.member_removed', { ...this.ref(a), userId }, { tx });
    if (a.status === 'active') await this.passwordDue(tx, a, reason, userId, auth, dedupeKey);
    return true;
  }

  /**
   * The password must be changed today: flags the account (keeping the first time it became due) and tells the
   * custodian, or the security officers when the custodian left or is inactive. Once per `dedupeKey`.
   */
  async passwordDue(
    tx: Db,
    a: SharedAccountRow,
    reason: PasswordReason,
    userId: string | null,
    auth: AuthContext,
    dedupeKey?: string,
  ) {
    const fresh = await this.event(tx, a.id, 'password_change_due', actorOf(auth), {
      userId,
      data: { reason },
      dedupeKey,
    });
    if (!fresh) return;
    await tx
      .update(sharedAccounts)
      .set({
        passwordDueSince: sql`coalesce(${sharedAccounts.passwordDueSince}, now())`,
        passwordDueReason: reason,
        passwordDueUserId: userId,
      })
      .where(eq(sharedAccounts.id, a.id));
    await this.ctx.audit.record(
      {
        action: 'isms.account.password_change_due',
        entityType: ACCOUNT_ENTITY,
        entityId: a.id,
        entityLabel: label(a),
        metadata: { reason, userId },
        category: 'security',
      },
      { tx },
    );
    await this.ctx.events.publish(
      'isms.account.password_change_due',
      { ...this.ref(a), reason, userId },
      { tx },
    );
    const people = await peopleByIds(tx, [a.custodianId, userId]);
    const custodian = a.custodianId ? people.get(a.custodianId) : undefined;
    const custodianGone = !custodian || custodian.status !== 'active' || reason === 'custodian_left';
    const recipients = custodianGone ? await roleHolders(tx, OFFICER_ROLES) : [custodian.id];
    await this.ctx.notifications.notify(
      {
        type: 'isms.account.password_change_due',
        recipients,
        params: {
          account: a.accountName,
          system: a.targetSystem ?? '',
          member: (userId ? people.get(userId)?.displayName : null) ?? '',
          reason,
        },
        href: accountHref(formatRef('account', a.number)),
      },
      { tx },
    );
  }

  async removeMember(ref: string, userId: string, auth: AuthContext) {
    const { row } = await this.readable(ref, auth);
    if (!canTendAccount(auth, row)) auth.require(P.accountsManage);
    await this.ctx.transaction(async (tx) => {
      const removed = await this.dropMember(tx, row, userId, 'member_removed', auth);
      if (!removed) throw httpErrors.notFound('Not a member');
    });
    return this.detail(row.id, auth);
  }

  async passwordChanged(ref: string, input: PasswordData, auth: AuthContext) {
    const { row } = await this.readable(ref, auth);
    if (!canTendAccount(auth, row)) auth.require(P.accountsManage);
    if (row.status !== 'active') throw invalidState('The account is retired', 'accountRetired');
    if (input.changedOn > companyToday())
      throw invalidField('changedOn', 'The date is in the future', 'future');
    await this.ctx.transaction(async (tx) => {
      // Under a lock: the same change recorded twice at once (or again) is recorded once.
      const [locked] = await tx
        .select()
        .from(sharedAccounts)
        .where(eq(sharedAccounts.id, row.id))
        .for('update');
      if (locked?.status !== 'active') throw invalidState('The account is retired', 'accountRetired');
      if (locked.lastPasswordChangeOn === input.changedOn && locked.passwordDueSince === null) return;
      await tx
        .update(sharedAccounts)
        .set({
          lastPasswordChangeOn: input.changedOn,
          passwordDueSince: null,
          passwordDueReason: null,
          passwordDueUserId: null,
        })
        .where(eq(sharedAccounts.id, row.id));
      await this.event(tx, row.id, 'password_changed', actorOf(auth), {
        note: input.note ?? null,
        data: { changedOn: input.changedOn, wasDue: locked.passwordDueSince !== null },
      });
      await this.ctx.audit.record(
        {
          action: 'isms.account.password_changed',
          entityType: ACCOUNT_ENTITY,
          entityId: row.id,
          entityLabel: label(row),
          metadata: { changedOn: input.changedOn, wasDue: locked.passwordDueSince !== null },
          category: 'security',
        },
        { tx },
      );
      await this.ctx.events.publish(
        'isms.account.password_changed',
        { ...this.ref(row), changedOn: input.changedOn },
        { tx },
      );
    });
    return this.detail(row.id, auth);
  }

  /** The yearly review: keeps the confirmed members, removes the others (password due) and sets the next review. */
  async review(ref: string, input: ReviewData, auth: AuthContext) {
    const { row, members } = await this.readable(ref, auth);
    if (!canTendAccount(auth, row)) auth.require(P.accountsManage);
    if (row.status !== 'active') throw invalidState('The account is retired', 'accountRetired');
    const unknown = input.memberIds.filter((m) => !members.includes(m));
    if (unknown.length) throw invalidField('memberIds', 'Only current members can be confirmed', 'notMember');
    const cfg = await ismsConfig(this.ctx);
    const today = companyToday();
    const nextReviewOn = addMonths(today, cfg.reviewMonths);
    await this.ctx.transaction(async (tx) => {
      // Under a lock, against the list as it is now: a review sent twice at once is recorded once.
      const [locked] = await tx
        .select()
        .from(sharedAccounts)
        .where(eq(sharedAccounts.id, row.id))
        .for('update');
      if (locked?.status !== 'active') throw invalidState('The account is retired', 'accountRetired');
      const current = await this.memberIds(row.id, tx);
      const dropping = current.filter((m) => !input.memberIds.includes(m));
      if (
        locked.lastReviewedOn === today &&
        locked.lastReviewedBy === actingUserId(auth) &&
        !dropping.length &&
        input.memberIds.every((m) => current.includes(m))
      )
        return;
      for (const userId of dropping) await this.dropMember(tx, row, userId, 'member_removed', auth);
      await tx
        .update(sharedAccounts)
        .set({
          lastReviewedOn: today,
          lastReviewedBy: actingUserId(auth),
          nextReviewOn,
          reviewNotifiedOn: null,
        })
        .where(eq(sharedAccounts.id, row.id));
      await this.event(tx, row.id, 'reviewed', actorOf(auth), {
        note: input.note ?? null,
        data: { kept: input.memberIds.length, removed: dropping.length, nextReviewOn },
      });
      await this.ctx.audit.record(
        {
          action: 'isms.account.reviewed',
          entityType: ACCOUNT_ENTITY,
          entityId: row.id,
          entityLabel: label(row),
          metadata: { members: input.memberIds, nextReviewOn },
        },
        { tx },
      );
      await this.ctx.events.publish('isms.account.reviewed', { ...this.ref(row), nextReviewOn }, { tx });
    });
    return this.detail(row.id, auth);
  }

  /* ───────────── people leaving and moving (event handlers) ───────────── */

  /**
   * Someone left (`member_left`: off every list, password due) or moved department (`member_moved`: password due;
   * they stay on the list until the custodian or a review takes them off). Accounts they look after are reported to
   * the security officers. Idempotent per event.
   */
  async onPersonChanged(
    userId: string,
    reason: 'member_left' | 'member_moved',
    eventId: string,
    auth: AuthContext,
  ) {
    const memberOf = await this.db
      .select({ account: sharedAccounts })
      .from(accountMembers)
      .innerJoin(sharedAccounts, eq(sharedAccounts.id, accountMembers.accountId))
      .where(and(eq(accountMembers.userId, userId), eq(sharedAccounts.status, 'active')));
    const custodianOf =
      reason === 'member_left'
        ? await this.db
            .select()
            .from(sharedAccounts)
            .where(and(eq(sharedAccounts.custodianId, userId), eq(sharedAccounts.status, 'active')))
        : [];
    let flagged = 0;
    for (const { account } of memberOf) {
      await this.ctx.transaction(async (tx) => {
        const key = `${reason}:${eventId}:${userId}`;
        if (reason === 'member_left') await this.dropMember(tx, account, userId, reason, auth, key);
        else await this.passwordDue(tx, account, reason, userId, auth, key);
      });
      flagged++;
    }
    for (const account of custodianOf) {
      if (memberOf.some((m) => m.account.id === account.id)) continue;
      await this.ctx.transaction(async (tx) => {
        await this.passwordDue(
          tx,
          account,
          'custodian_left',
          userId,
          auth,
          `custodian_left:${eventId}:${userId}`,
        );
      });
      flagged++;
    }
    return flagged;
  }

  /* ───────────── process action ───────────── */

  /**
   * Registers (or updates) an account from an approved request: an active account with the same name on the same
   * system gets the new members and custodian; otherwise a new one. Idempotent on `runId`.
   */
  async registerFromRequest(
    input: {
      accountName: string;
      targetSystem: string | null;
      targetRef: string | null;
      custodianId: string;
      memberIds: string[];
      purpose: string | null;
      project: string | null;
      requestReference: string;
      runId: string;
    },
    auth: AuthContext,
  ): Promise<{ account: SharedAccountRow; created: boolean }> {
    const dedupeKey = `run:${input.runId}`;
    const [done] = await this.db
      .select({ accountId: accountEvents.accountId })
      .from(accountEvents)
      .where(eq(accountEvents.dedupeKey, dedupeKey));
    if (done) return { account: await this.row(done.accountId), created: false };
    const [existing] = await this.db
      .select()
      .from(sharedAccounts)
      .where(
        and(
          eq(sharedAccounts.status, 'active'),
          sql`lower(${sharedAccounts.accountName}) = lower(${input.accountName})`,
          input.targetSystem
            ? sql`lower(coalesce(${sharedAccounts.targetSystem}, '')) = lower(${input.targetSystem})`
            : input.targetRef
              ? eq(sharedAccounts.targetRef, input.targetRef)
              : undefined,
        ),
      )
      .orderBy(asc(sharedAccounts.number))
      .limit(1);
    try {
      return await this.ctx.transaction(async (tx) => {
        if (!existing) {
          const account = await this.create(
            {
              accountName: input.accountName,
              targetSystem: input.targetSystem,
              targetRef: input.targetRef,
              custodianId: input.custodianId,
              memberIds: input.memberIds,
              purpose: input.purpose,
              project: input.project,
              requestReference: input.requestReference,
              departmentId: null,
              lastPasswordChangeOn: null,
              nextReviewOn: null,
              notes: null,
            },
            auth,
            { tx, dedupeKey, note: input.requestReference },
          );
          return { account, created: true };
        }
        const members = await this.memberIds(existing.id, tx);
        await this.update(
          existing.id,
          {
            custodianId: input.custodianId,
            memberIds: [...new Set([...members, ...input.memberIds])],
            ...(input.purpose ? { purpose: input.purpose } : {}),
            ...(input.project ? { project: input.project } : {}),
            requestReference: input.requestReference,
          },
          auth,
          { tx },
        );
        await this.event(tx, existing.id, 'registered', actorOf(auth), {
          note: input.requestReference,
          dedupeKey,
          data: { members: input.memberIds },
        });
        return { account: await this.row(existing.id, tx), created: false };
      });
    } catch (err) {
      // A concurrent attempt of the same run got there first.
      if (pgCode(err) === UNIQUE_VIOLATION) {
        const [again] = await this.db
          .select({ accountId: accountEvents.accountId })
          .from(accountEvents)
          .where(eq(accountEvents.dedupeKey, dedupeKey));
        if (again) return { account: await this.row(again.accountId), created: false };
      }
      throw err;
    }
  }

  /* ───────────── schedule & dashboard ───────────── */

  /** Daily: tells custodians when the yearly review of their account is due (once per review date). */
  async daily(log: (m: string) => void = () => undefined) {
    const today = companyToday();
    const due = await this.db
      .select()
      .from(sharedAccounts)
      .where(
        and(
          eq(sharedAccounts.status, 'active'),
          lte(sharedAccounts.nextReviewOn, today),
          or(
            sql`${sharedAccounts.reviewNotifiedOn} is null`,
            sql`${sharedAccounts.reviewNotifiedOn} < ${sharedAccounts.nextReviewOn}`,
          ),
        ),
      );
    for (const a of due) {
      await this.ctx.transaction(async (tx) => {
        await this.ctx.notifications.notify(
          {
            type: 'isms.account.review_due',
            recipients: [a.custodianId],
            params: { account: a.accountName, due: a.nextReviewOn! },
            href: accountHref(formatRef('account', a.number)),
          },
          { tx },
        );
        await tx.update(sharedAccounts).set({ reviewNotifiedOn: today }).where(eq(sharedAccounts.id, a.id));
      });
    }
    log(`shared accounts: ${due.length} review reminders`);
    return { reviewReminders: due.length };
  }

  /** Accounts with a password change due that the caller looks after (or all, for readers). */
  async passwordDueFor(auth: AuthContext) {
    const all = canReadAllAccounts(auth);
    const rows = await this.db
      .select({
        id: sharedAccounts.id,
        number: sharedAccounts.number,
        accountName: sharedAccounts.accountName,
      })
      .from(sharedAccounts)
      .where(
        and(
          eq(sharedAccounts.status, 'active'),
          isNotNull(sharedAccounts.passwordDueSince),
          all ? undefined : auth.user ? eq(sharedAccounts.custodianId, auth.user.id) : sql`false`,
        ),
      )
      .orderBy(asc(sharedAccounts.passwordDueSince))
      .limit(10);
    return rows.map((r) => ({
      id: r.id,
      reference: formatRef('account', r.number),
      accountName: r.accountName,
    }));
  }

  /** Record resolver rows: readable accounts only. */
  async readableRows(ids: readonly string[], auth: AuthContext, where?: SQL, limit = 50) {
    const all = canReadAllAccounts(auth);
    if (!all && !auth.can(P.self)) return [];
    return this.db
      .select()
      .from(sharedAccounts)
      .where(
        and(
          ids.length ? inArray(sharedAccounts.id, [...ids]) : undefined,
          where,
          all ? undefined : this.mine(auth.user?.id ?? null),
        ),
      )
      .orderBy(asc(sharedAccounts.accountName))
      .limit(limit);
  }
}
