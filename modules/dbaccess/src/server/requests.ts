/**
 * The request flow: the catalog of requestable roles, submitting (one request and one approval workflow per
 * role), cancelling, and what happens when the `dbaccess.request` workflow completes.
 */
import { approvalTasks } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  localize,
  type ModuleContext,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import type {
  AccessRequestOut as AccessRequest,
  CatalogItemOut as CatalogItem,
  CreateRequestInput,
  RequestPreview,
  RequestPreviewInput,
} from '../contracts';
import { createRequestSchema, requestPreviewInputSchema } from '../contracts';
import { REQUEST_TRIGGER, type RequestFacts } from '../manifest';
import {
  checkDuration,
  daysBetween,
  formatRequestRef,
  grantExpiry,
  maxDateFor,
  REQUEST_REF_RE,
  todayIn,
  viewStatus,
} from '../model';
import { groupsOf, isRoleOwner, PERMISSIONS, personOf } from './access';
import type { GrantService } from './grants';
import { grants, requestableRoles, requests, servers } from './schema';
import type { ServerService } from './servers';
import {
  activeMembers,
  peopleByIds,
  personById,
  personRef,
  roleRef,
  type RoleRow,
  serverRef,
} from './support';

export type RequestRow = typeof requests.$inferSelect;
const REQUEST_ENTITY = 'dbaccess.request';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const issue = (path: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });

export class RequestService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly serversSvc: ServerService,
    private readonly grantsSvc: GrantService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  async row(ref: string): Promise<RequestRow> {
    const m = REQUEST_REF_RE.exec(ref);
    const where = m ? eq(requests.number, Number(m[1])) : UUID_RE.test(ref) ? eq(requests.id, ref) : null;
    if (!where) throw httpErrors.notFound('Request not found');
    const [row] = await this.db.select().from(requests).where(where);
    if (!row) throw httpErrors.notFound('Request not found');
    return row;
  }

  /* ───────────── catalog ───────────── */

  async catalog(
    query: { q?: string; serverId?: string; database?: string; risk?: string },
    auth: AuthContext,
  ): Promise<CatalogItem[]> {
    const me = personOf(auth);
    const where = [eq(requestableRoles.active, true)];
    if (query.serverId) where.push(eq(requestableRoles.serverId, query.serverId));
    if (query.database) where.push(eq(requestableRoles.database, query.database));
    if (query.risk) where.push(eq(requestableRoles.risk, query.risk as RoleRow['risk']));
    if (query.q) {
      const p = likePattern(query.q);
      where.push(
        or(
          ilike(requestableRoles.roleName, p),
          ilike(requestableRoles.database, p),
          sql`${requestableRoles.name}::text ilike ${p}`,
          sql`coalesce(${requestableRoles.description}::text, '') ilike ${p}`,
          ilike(servers.displayName, p),
        )!,
      );
    }
    const rows = await this.db
      .select({ r: requestableRoles })
      .from(requestableRoles)
      .innerJoin(servers, eq(servers.id, requestableRoles.serverId))
      .where(and(...where))
      .orderBy(asc(servers.displayName), asc(requestableRoles.database), asc(requestableRoles.roleName));
    const dtos = await this.serversSvc.roleDtos(rows.map((r) => r.r));
    const held = me
      ? await this.db
          .select({ id: grants.id, roleId: grants.roleId, expiresAt: grants.expiresAt })
          .from(grants)
          .where(and(eq(grants.userId, me), inArray(grants.status, ['provisioning', 'active', 'failed'])))
      : [];
    const pending = me
      ? await this.db
          .select({ id: requests.id, number: requests.number, roleId: requests.roleId })
          .from(requests)
          .where(and(eq(requests.requesterId, me), eq(requests.status, 'pending')))
      : [];
    const heldBy = new Map(held.map((h) => [h.roleId, h]));
    const pendingBy = new Map(pending.map((p) => [p.roleId, p]));
    return dtos.map(({ liveGrants: _l, active: _a, createdAt: _c, updatedAt: _u, ...r }) => {
      const h = heldBy.get(r.id);
      const p = pendingBy.get(r.id);
      return {
        ...r,
        heldGrantId: h?.id ?? null,
        heldUntil: h?.expiresAt ?? null,
        pendingRequest: p ? { id: p.id, reference: formatRequestRef(p.number) } : null,
      };
    });
  }

  /* ───────────── preview ───────────── */

  /** What the request workflow decides on: the role's risk, owners (its approvers), environment and duration. */
  private async factsFor(
    db: Db,
    role: typeof requestableRoles.$inferSelect,
    server: Pick<typeof servers.$inferSelect, 'environment'>,
    expiresOn: string | null,
    today: string,
  ): Promise<RequestFacts> {
    const approverIds = role.ownerUserId
      ? [role.ownerUserId]
      : role.ownerGroupId
        ? await activeMembers(db, role.ownerGroupId)
        : [];
    return {
      role: {
        risk: role.risk,
        approverIds,
        environment: server.environment,
        permanent: expiresOn === null,
        days: expiresOn ? daysBetween(today, expiresOn) : 0,
      },
    };
  }

  /**
   * "Who will approve it" before sending: a dry run of the request workflow for each role (nothing is saved), with
   * the same facts `submit` starts it with. Roles that can't be requested are left out; `steps` is empty when no
   * workflow would run.
   */
  async preview(raw: RequestPreviewInput, auth: AuthContext): Promise<RequestPreview> {
    const input = requestPreviewInputSchema.parse(raw);
    const me = personOf(auth);
    if (!me) throw httpErrors.forbidden('Only people can request database access');
    const person = await personById(this.db, me);
    const today = todayIn(auth.user?.timezone ?? person?.timezone ?? 'UTC');
    const roleRows = await this.db
      .select()
      .from(requestableRoles)
      .where(
        inArray(
          requestableRoles.id,
          input.items.map((i) => i.roleId),
        ),
      );
    const roleBy = new Map(roleRows.map((r) => [r.id, r]));
    const serverBy = await this.serversSvc.rowsByIds(roleRows.map((r) => r.serverId));
    const items: RequestPreview['items'] = [];
    for (const item of input.items) {
      const role = roleBy.get(item.roleId);
      const server = role ? serverBy.get(role.serverId) : undefined;
      if (!role?.active || !server) continue;
      const facts = await this.factsFor(this.db, role, server, item.expiresOn, today);
      const path = await this.ctx.workflows.preview(REQUEST_TRIGGER, {
        facts,
        requesterId: me,
        subjectUserId: me,
      });
      items.push({ roleId: role.id, steps: path?.steps ?? [] });
    }
    return { items };
  }

  /* ───────────── submit ───────────── */

  async submit(raw: CreateRequestInput, auth: AuthContext): Promise<AccessRequest[]> {
    const input = createRequestSchema.parse(raw);
    const me = personOf(auth);
    if (!me) throw httpErrors.forbidden('Only people can request database access');
    const person = await personById(this.db, me);
    if (!person || person.status !== 'active')
      throw new HttpError(
        409,
        ErrorCodes.PRINCIPAL_OFFBOARDED,
        'Access can only be requested for active people',
      );
    const timeZone = auth.user?.timezone ?? person.timezone ?? 'UTC';
    const today = todayIn(timeZone);
    const roleRows = await this.db
      .select()
      .from(requestableRoles)
      .where(
        inArray(
          requestableRoles.id,
          input.items.map((i) => i.roleId),
        ),
      );
    const roleBy = new Map(roleRows.map((r) => [r.id, r]));
    const serverBy = await this.serversSvc.rowsByIds(roleRows.map((r) => r.serverId));

    let extension: typeof grants.$inferSelect | null = null;
    if (input.extensionOf) {
      extension = await this.grantsSvc.row(input.extensionOf);
      if (
        extension.userId !== me ||
        extension.status !== 'active' ||
        input.items.length !== 1 ||
        input.items[0]!.roleId !== extension.roleId
      )
        throw new HttpError(
          409,
          ErrorCodes.INVALID_STATE,
          'Only your active access to this role can be extended',
        );
    }

    for (const [i, item] of input.items.entries()) {
      const role = roleBy.get(item.roleId);
      if (!role || !role.active || !serverBy.has(role.serverId))
        throw new HttpError(409, ErrorCodes.NOT_REQUESTABLE, 'This role cannot be requested', {
          roleId: item.roleId,
        });
      const check = checkDuration(role, item.expiresOn, today);
      if (check === 'past') throw issue(`items.${i}.expiresOn`, 'The end date must be in the future');
      if (check !== 'ok')
        throw new HttpError(
          409,
          ErrorCodes.DURATION_TOO_LONG,
          role.maxDays
            ? `This role can be granted for at most ${role.maxDays} days`
            : 'This role must have an end date',
          {
            roleId: role.id,
            maxDays: role.maxDays,
            maxDate: maxDateFor(role, today),
            allowPermanent: role.allowPermanent,
          },
        );
      if (role.justificationRequired && input.justification.length < 10)
        throw issue('justification', 'Say why you need this access (at least 10 characters)');
      const [held] = await this.db
        .select({ id: grants.id })
        .from(grants)
        .where(
          and(
            eq(grants.userId, me),
            eq(grants.roleId, role.id),
            inArray(grants.status, ['provisioning', 'active', 'failed']),
          ),
        );
      if (held && held.id !== extension?.id)
        throw new HttpError(409, ErrorCodes.ALREADY_GRANTED, 'You already have this access', {
          roleId: role.id,
          grantId: held.id,
        });
      const [dup] = await this.db
        .select({ id: requests.id, number: requests.number })
        .from(requests)
        .where(
          and(eq(requests.requesterId, me), eq(requests.roleId, role.id), eq(requests.status, 'pending')),
        );
      if (dup)
        throw new HttpError(
          409,
          ErrorCodes.DUPLICATE_REQUEST,
          'An open request for this access already exists',
          {
            requestId: dup.id,
            reference: formatRequestRef(dup.number),
          },
        );
    }

    const created = await this.ctx.transaction(async (tx) => {
      const out: RequestRow[] = [];
      for (const item of input.items) {
        const role = roleBy.get(item.roleId)!;
        const server = serverBy.get(role.serverId)!;
        const [row] = await tx
          .insert(requests)
          .values({
            requesterId: me,
            roleId: role.id,
            serverId: server.id,
            expiresOn: item.expiresOn,
            timeZone,
            justification: input.justification,
            extensionOf: extension?.id ?? null,
          })
          .returning();
        const r = row!;
        const reference = formatRequestRef(r.number);
        const facts = await this.factsFor(tx, role, server, item.expiresOn, today);
        const label = Object.fromEntries(
          (['en', 'zh-TW', 'ja-JP'] as const).map((l) => [
            l,
            `${reference} ${localize(role.name, l) || role.roleName} · ${server.displayName}`,
          ]),
        );
        const started = await this.ctx.workflows.start(
          REQUEST_TRIGGER,
          {
            subject: { type: 'request', id: r.id, label, href: `/dbaccess/requests/${reference}` },
            facts,
            requesterId: me,
            subjectUserId: me,
          },
          { tx },
        );
        await tx
          .update(requests)
          .set({ instanceId: started?.instanceId ?? null })
          .where(eq(requests.id, r.id));
        await this.ctx.audit.record(
          {
            action: 'dbaccess.request.submitted',
            entityType: REQUEST_ENTITY,
            entityId: r.id,
            entityLabel: `${reference} ${role.roleName}`,
            metadata: {
              server: server.displayName,
              risk: role.risk,
              expiresOn: item.expiresOn,
              extensionOf: extension?.id ?? null,
              instanceId: started?.instanceId ?? null,
            },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'dbaccess.request.submitted',
          { requestId: r.id, reference, userId: me, roleId: role.id, risk: role.risk },
          { tx },
        );
        await this.grantsSvc.trackRequest(tx, r.id, 'pending');
        out.push({ ...r, instanceId: started?.instanceId ?? null });
      }
      return out;
    });
    return this.toDtos(created, auth);
  }

  /* ───────────── workflow outcome ───────────── */

  async onCompleted(result: WorkflowCompletion) {
    const [r] = await this.db.select().from(requests).where(eq(requests.id, result.subjectId));
    if (!r || r.status !== 'pending') return;
    const [role] = await this.db.select().from(requestableRoles).where(eq(requestableRoles.id, r.roleId));
    const [server] = await this.db.select().from(servers).where(eq(servers.id, r.serverId));
    if (!role || !server) return;
    const reference = formatRequestRef(r.number);
    const ref = { requestId: r.id, reference, userId: r.requesterId, roleId: r.roleId };
    const now = new Date();
    let provision: string | null = null;
    let extended: string | null = null;
    await this.ctx.transaction(async (tx) => {
      const [claimed] = await tx
        .update(requests)
        .set({
          status: result.outcome === 'approved' ? 'approved' : result.outcome,
          decidedAt: now,
          decisionComment: result.comment,
        })
        .where(and(eq(requests.id, r.id), eq(requests.status, 'pending')))
        .returning();
      if (!claimed) return;
      if (result.outcome === 'approved') {
        const extend = r.extensionOf ? await this.extendable(tx, r) : null;
        if (extend) {
          const expiresAt = grantExpiry(r.expiresOn, role, r.timeZone);
          await tx.update(grants).set({ expiresAt, expiryRemindedAt: null }).where(eq(grants.id, extend.id));
          await tx.update(requests).set({ grantId: extend.id }).where(eq(requests.id, r.id));
          await this.ctx.audit.record(
            {
              action: 'dbaccess.grant.extended',
              entityType: 'dbaccess.grant',
              entityId: extend.id,
              entityLabel: `${extend.accountName ?? '?'} → ${role.roleName}`,
              changes: {
                expiresAt: [extend.expiresAt?.toISOString() ?? null, expiresAt?.toISOString() ?? null],
              },
              metadata: { requestId: r.id },
            },
            { tx },
          );
          await this.ctx.events.publish(
            'dbaccess.grant.extended',
            {
              grantId: extend.id,
              userId: extend.userId,
              serverId: extend.serverId,
              roleId: extend.roleId,
              accountName: extend.accountName,
              expiresAt: expiresAt?.toISOString() ?? null,
            },
            { tx },
          );
          extended = extend.id;
          await this.grantsSvc.trackRequest(tx, r.id, 'active');
        } else {
          const g = await this.grantsSvc.createForRequest(tx, r, role);
          await tx.update(requests).set({ grantId: g.id }).where(eq(requests.id, r.id));
          provision = g.id;
          await this.grantsSvc.trackRequest(tx, r.id, 'provisioning');
        }
        await this.ctx.notifications.notify(
          {
            type: 'dbaccess.request.approved',
            recipients: [r.requesterId],
            params: {
              reference,
              role: role.name,
              server: server.displayName,
              extension: extended ? 'yes' : 'no',
            },
            href: `/dbaccess/requests/${reference}`,
          },
          { tx },
        );
      } else {
        await this.grantsSvc.trackRequest(tx, r.id, result.outcome);
        if (result.outcome === 'rejected')
          await this.ctx.notifications.notify(
            {
              type: 'dbaccess.request.rejected',
              recipients: [r.requesterId],
              params: {
                reference,
                role: role.name,
                server: server.displayName,
                comment: result.comment ?? '',
              },
              href: `/dbaccess/requests/${reference}`,
            },
            { tx },
          );
      }
      await this.ctx.audit.record(
        {
          action: `dbaccess.request.${result.outcome}`,
          entityType: REQUEST_ENTITY,
          entityId: r.id,
          entityLabel: `${reference} ${role.roleName}`,
          metadata: { instanceId: result.instanceId, comment: result.comment },
        },
        { tx },
      );
      await this.ctx.events.publish(`dbaccess.request.${result.outcome}`, ref, { tx });
    });
    if (provision) await this.grantsSvc.enqueue('provision', provision);
    if (extended)
      await this.grantsSvc
        .refreshValidity(extended)
        .catch((err) => this.ctx.logger.warn({ err }, 'valid-until refresh failed'));
  }

  private async extendable(tx: Db, r: RequestRow) {
    const [g] = await tx.select().from(grants).where(eq(grants.id, r.extensionOf!));
    return g && g.status === 'active' && g.userId === r.requesterId && g.roleId === r.roleId ? g : null;
  }

  /* ───────────── read & cancel ───────────── */

  async detail(ref: string, auth: AuthContext): Promise<AccessRequest> {
    const r = await this.row(ref);
    await this.requireView(r, auth);
    return (await this.toDtos([r], auth))[0]!;
  }

  /** The requester, grants readers, the role owner and anyone with an approval task on it. */
  private async requireView(r: RequestRow, auth: AuthContext) {
    const me = personOf(auth);
    if (me && r.requesterId === me) return;
    if (auth.can(PERMISSIONS.grantsRead)) return;
    const role = await this.serversSvc.roleRow(r.roleId);
    if (isRoleOwner(me, role, await groupsOf(this.db, auth))) return;
    if (me && r.instanceId) {
      const [task] = await this.db
        .select({ id: approvalTasks.id })
        .from(approvalTasks)
        .where(and(eq(approvalTasks.instanceId, r.instanceId), eq(approvalTasks.assigneeId, me)))
        .limit(1);
      if (task) return;
    }
    auth.require(PERMISSIONS.grantsRead);
  }

  async cancel(ref: string, auth: AuthContext): Promise<AccessRequest> {
    const r = await this.row(ref);
    const me = personOf(auth);
    if (!me || r.requesterId !== me) throw httpErrors.forbidden('Only the requester can withdraw a request');
    if (r.status !== 'pending')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This request is no longer pending');
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(requests)
        .set({ status: 'cancelled', decidedAt: new Date(), decisionComment: null })
        .where(eq(requests.id, r.id));
      if (r.instanceId) await this.ctx.workflows.cancel(r.instanceId, 'Withdrawn by the requester', { tx });
      await this.ctx.audit.record(
        {
          action: 'dbaccess.request.cancelled',
          entityType: REQUEST_ENTITY,
          entityId: r.id,
          entityLabel: formatRequestRef(r.number),
        },
        { tx },
      );
      await this.ctx.events.publish(
        'dbaccess.request.cancelled',
        { requestId: r.id, reference: formatRequestRef(r.number), userId: r.requesterId, roleId: r.roleId },
        { tx },
      );
      await this.grantsSvc.trackRequest(tx, r.id, 'cancelled');
    });
    return this.detail(r.id, auth);
  }

  async mine(auth: AuthContext): Promise<AccessRequest[]> {
    const me = personOf(auth);
    if (!me) return [];
    const since = new Date(Date.now() - 90 * DAY_MS);
    const rows = await this.db
      .select()
      .from(requests)
      .where(
        and(eq(requests.requesterId, me), or(eq(requests.status, 'pending'), gt(requests.createdAt, since))),
      )
      .orderBy(desc(requests.createdAt))
      .limit(50);
    return this.toDtos(rows, auth);
  }

  async toDtos(rows: RequestRow[], auth: AuthContext): Promise<AccessRequest[]> {
    if (!rows.length) return [];
    const now = new Date();
    const roleRows = await this.db
      .select()
      .from(requestableRoles)
      .where(inArray(requestableRoles.id, [...new Set(rows.map((r) => r.roleId))]));
    const roleBy = new Map(roleRows.map((r) => [r.id, r]));
    const serverBy = await this.serversSvc.rowsByIds(rows.map((r) => r.serverId));
    const people = await peopleByIds(
      this.db,
      rows.map((r) => r.requesterId),
    );
    const grantIds = rows.map((r) => r.grantId).filter((x): x is string => Boolean(x));
    const grantRows = grantIds.length
      ? await this.db
          .select({ id: grants.id, status: grants.status, expiresAt: grants.expiresAt })
          .from(grants)
          .where(inArray(grants.id, grantIds))
      : [];
    const grantBy = new Map(grantRows.map((g) => [g.id, g]));
    const me = personOf(auth);
    return rows.map((r) => {
      const g = r.grantId ? grantBy.get(r.grantId) : undefined;
      return {
        id: r.id,
        reference: formatRequestRef(r.number),
        status: r.status,
        role: roleRef(roleBy.get(r.roleId)!),
        server: serverRef(serverBy.get(r.serverId)!),
        requester: personRef(r.requesterId ? people.get(r.requesterId) : null),
        expiresOn: r.expiresOn,
        justification: r.justification,
        extensionOf: r.extensionOf,
        instanceId: r.instanceId,
        decidedAt: r.decidedAt,
        decisionComment: r.decisionComment,
        grant: g ? { id: g.id, status: g.status, viewStatus: viewStatus(g.status, g.expiresAt, now) } : null,
        canCancel: r.status === 'pending' && Boolean(me) && r.requesterId === me,
        createdAt: r.createdAt,
      };
    });
  }

  /** Requests for an AI tool: resolve a role by id, database role name or display name. */
  async findRole(role: string, server?: string): Promise<RoleRow> {
    const rows = await this.db
      .select({ r: requestableRoles, serverName: servers.displayName })
      .from(requestableRoles)
      .innerJoin(servers, eq(servers.id, requestableRoles.serverId))
      .where(
        and(
          eq(requestableRoles.active, true),
          UUID_RE.test(role)
            ? eq(requestableRoles.id, role)
            : or(
                sql`lower(${requestableRoles.roleName}) = lower(${role})`,
                sql`${requestableRoles.name}::text ilike ${likePattern(role)}`,
              ),
          server ? ilike(servers.displayName, likePattern(server)) : undefined,
        ),
      )
      .limit(5);
    if (!rows.length)
      throw new HttpError(409, ErrorCodes.NOT_REQUESTABLE, `No requestable role matches "${role}"`);
    if (rows.length > 1)
      throw new HttpError(409, ErrorCodes.CONFLICT, 'Several roles match: name the server too', {
        matches: rows.map((x) => `${x.r.roleName} (${x.serverName})`),
      });
    return rows[0]!.r;
  }
}
