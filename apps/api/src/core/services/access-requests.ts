import {
  type accessRequestQuerySchema,
  type createAccessRequestSchema,
  formatRequestNumber,
  type myRequestQuerySchema,
  type requestableRoleQuerySchema,
} from '@isbp/contracts';
import {
  accessRequests,
  applications,
  departments,
  formSubmissions,
  forms,
  groupMembers,
  groups,
  roleAssignments,
  roles,
  users,
  workflowInstances,
  portalItems,
  type SubmissionFulfilment,
} from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type LocalizedText,
  type ModuleContext,
  type WorkflowCompletion,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { PLATFORM_APP_KEY } from '../../kernel/rbac';
import { catalogLocalized } from '../customizations/shared';
import { getKernel } from '../kernel-ref';
import { likePattern, pageOffset } from '../util';
import { peopleById, ref } from './people';
import { InstanceViews } from './workflows';
import { NO_APPROVAL_PATH, requestPath } from './request-path';

export const ACCESS_REQUEST_TRIGGER = 'core.access-request';

/** A role's name in every locale: module roles from `<moduleId>.systemRoles.<key>.name`, the stored name otherwise. */
async function roleTitle(moduleId: string | null, key: string, name: string): Promise<LocalizedText> {
  if (!moduleId) return { en: name };
  const catalogKey = `${moduleId}.systemRoles.${key}.name`;
  const texts = await catalogLocalized(catalogKey);
  return Object.fromEntries(Object.entries(texts).map(([l, v]) => [l, v === catalogKey ? name : v]));
}
type RequestRow = typeof accessRequests.$inferSelect;
const DAY = 86_400_000;

/**
 * Why access can't be requested for (or granted to) a person in this lifecycle state, or null when it can.
 * Pre-boarded people (`pending`) can get access before their first day: grants only take effect once they're
 * onboarded, because RBAC resolves nothing for people who aren't active. `reason` is the request's `failureReason`
 * when the state changed while the request was waiting for approval.
 */
export function beneficiaryRefusal(
  status: string,
): { code: string; message: string; reason: 'beneficiary_suspended' | 'beneficiary_offboarded' } | null {
  switch (status) {
    case 'active':
    case 'pending':
      return null;
    case 'suspended':
      return {
        code: ErrorCodes.PRINCIPAL_SUSPENDED,
        message: 'This person is suspended; reactivate them before requesting access',
        reason: 'beneficiary_suspended',
      };
    default:
      return {
        code: ErrorCodes.PRINCIPAL_OFFBOARDED,
        message: 'This person has been offboarded',
        reason: 'beneficiary_offboarded',
      };
  }
}

/** Self-service role requests: submitted here, decided by the `core.access-request` workflow. */
export class AccessRequestService {
  private readonly views: InstanceViews;

  constructor(private readonly ctx: ModuleContext) {
    this.views = new InstanceViews(ctx);
  }

  private get db() {
    return this.ctx.db;
  }

  /** Roles anyone can ask for, with whether the person already has / asked for each. */
  async requestable(q: z.output<typeof requestableRoleQuerySchema>, auth: AuthContext) {
    const forId = q.for ?? auth.user!.id;
    const rows = await this.db
      .select({
        r: roles,
        app: { id: applications.id, key: applications.key, name: applications.name },
        ownerName: users.displayName,
        ownerAvatar: users.avatarUrl,
      })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .leftJoin(users, eq(users.id, roles.ownerId))
      .where(
        and(
          eq(roles.requestable, true),
          q.applicationId ? eq(roles.applicationId, q.applicationId) : undefined,
          q.q
            ? or(
                ilike(roles.name, likePattern(q.q)),
                ilike(roles.description, likePattern(q.q)),
                ilike(applications.name, likePattern(q.q)),
              )
            : undefined,
        ),
      )
      .orderBy(sql`${applications.key} = ${PLATFORM_APP_KEY} desc`, asc(applications.name), asc(roles.name));
    const roleIds = rows.map((r) => r.r.id);
    const [held, pending] = roleIds.length
      ? await Promise.all([
          this.db
            .select({ roleId: roleAssignments.roleId })
            .from(roleAssignments)
            .where(
              and(
                inArray(roleAssignments.roleId, roleIds),
                eq(roleAssignments.userId, forId),
                eq(roleAssignments.scopeType, 'global'),
                or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
              ),
            ),
          this.db
            .select({ id: accessRequests.id, roleId: accessRequests.roleId, number: accessRequests.number })
            .from(accessRequests)
            .where(
              and(
                inArray(accessRequests.roleId, roleIds),
                eq(accessRequests.beneficiaryId, forId),
                eq(accessRequests.status, 'pending'),
              ),
            ),
        ])
      : [[], []];
    return rows.map((r) => {
      const p = pending.find((x) => x.roleId === r.r.id);
      return {
        id: r.r.id,
        key: r.r.key,
        name: r.r.name,
        description: r.r.description,
        moduleId: r.r.moduleId,
        application: { ...r.app, isPlatform: r.app.key === PLATFORM_APP_KEY },
        riskLevel: r.r.riskLevel,
        maxDurationDays: r.r.maxDurationDays,
        owner: r.r.ownerId
          ? { id: r.r.ownerId, displayName: r.ownerName ?? '?', avatarUrl: r.ownerAvatar ?? null }
          : null,
        held: held.some((h) => h.roleId === r.r.id),
        pendingRequest: p ? { id: p.id, reference: formatRequestNumber(p.number) } : null,
      };
    });
  }

  /** You, your direct reports, or anyone in your reach when you may assign roles. */
  private async assertMayRequestFor(beneficiaryId: string, auth: AuthContext) {
    const me = auth.user!.id;
    if (beneficiaryId === me) return;
    const [b] = await this.db
      .select({ managerId: users.managerId, departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, beneficiaryId));
    if (!b) throw httpErrors.notFound('Person not found');
    if (b.managerId === me) return;
    if (auth.can('core.roles.assign', { departmentId: b.departmentId })) return;
    throw httpErrors.forbidden('You can request access for yourself and your direct reports');
  }

  /** Who would decide this request (dry run of the workflow with the real facts). */
  async preview(
    input: {
      roleId: string;
      beneficiaryId?: string | null;
      durationDays?: number | null;
      scopeType?: 'global' | 'department';
    },
    auth: AuthContext,
  ) {
    const me = auth.user!.id;
    const beneficiaryId = input.beneficiaryId ?? me;
    await this.assertMayRequestFor(beneficiaryId, auth);
    const [row] = await this.db
      .select({ r: roles, appKey: applications.key })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .where(eq(roles.id, input.roleId));
    if (!row || !row.r.requestable)
      throw new HttpError(409, ErrorCodes.NOT_REQUESTABLE, 'This role cannot be requested');
    const durationDays = input.durationDays ?? null;
    const result = await getKernel().workflows.preview(ACCESS_REQUEST_TRIGGER, {
      facts: {
        role: {
          id: row.r.id,
          key: row.r.key,
          name: row.r.name,
          riskLevel: row.r.riskLevel,
          ownerId: row.r.ownerId,
          application: row.appKey,
        },
        request: {
          durationDays,
          permanent: durationDays === null,
          scopeType: input.scopeType ?? 'global',
          forSomeoneElse: beneficiaryId !== me,
        },
      },
      requesterId: me,
      subjectUserId: beneficiaryId,
      definitionId: row.r.requestWorkflowId,
    });
    if (!result) return { steps: [] };
    const people = await peopleById(
      this.db,
      result.steps.flatMap((s) => [...s.people, ...(s.counted ?? []).map((c) => c.id)]),
    );
    return {
      steps: result.steps.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        outcome: s.outcome,
        people: s.people.map((id) => ref(people, id)!),
        ...(s.counted
          ? { counted: s.counted.map((c) => ({ person: ref(people, c.id)!, approvedAt: c.approvedAt })) }
          : {}),
      })),
    };
  }

  async create(input: z.output<typeof createAccessRequestSchema>, auth: AuthContext) {
    const me = auth.user!.id;
    const beneficiaryId = input.beneficiaryId ?? me;
    await this.assertMayRequestFor(beneficiaryId, auth);

    const [row] = await this.db
      .select({ r: roles, appKey: applications.key, appName: applications.name })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .where(eq(roles.id, input.roleId));
    if (!row || !row.r.requestable)
      throw new HttpError(409, ErrorCodes.NOT_REQUESTABLE, 'This role cannot be requested');
    const role = row.r;
    const [beneficiary] = await this.db
      .select({ id: users.id, name: users.displayName, status: users.status })
      .from(users)
      .where(eq(users.id, beneficiaryId));
    if (!beneficiary) throw httpErrors.notFound('Person not found');
    const refusal = beneficiaryRefusal(beneficiary.status);
    if (refusal) throw new HttpError(409, refusal.code, refusal.message, { status: beneficiary.status });

    const durationDays = input.durationDays ?? null;
    if (role.maxDurationDays && (durationDays === null || durationDays > role.maxDurationDays))
      throw new HttpError(
        409,
        ErrorCodes.DURATION_TOO_LONG,
        `This role can be granted for at most ${role.maxDurationDays} days`,
        {
          maxDurationDays: role.maxDurationDays,
        },
      );
    const scopeDepartmentId = input.scopeType === 'department' ? input.scopeDepartmentId! : null;

    const [existing] = await this.db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.roleId, role.id),
          eq(roleAssignments.userId, beneficiaryId),
          eq(roleAssignments.scopeType, input.scopeType),
          scopeDepartmentId
            ? eq(roleAssignments.scopeDepartmentId, scopeDepartmentId)
            : isNull(roleAssignments.scopeDepartmentId),
          or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
        ),
      );
    if (existing) throw new HttpError(409, ErrorCodes.ALREADY_GRANTED, 'This access is already granted');
    const [dup] = await this.db
      .select({ id: accessRequests.id, number: accessRequests.number })
      .from(accessRequests)
      .where(
        and(
          eq(accessRequests.roleId, role.id),
          eq(accessRequests.beneficiaryId, beneficiaryId),
          eq(accessRequests.status, 'pending'),
        ),
      );
    if (dup)
      throw new HttpError(
        409,
        ErrorCodes.DUPLICATE_REQUEST,
        'An open request for this access already exists',
        {
          requestId: dup.id,
          reference: formatRequestNumber(dup.number),
        },
      );

    const created = await this.ctx.transaction(async (tx) => {
      const [req] = await tx
        .insert(accessRequests)
        .values({
          requesterId: me,
          beneficiaryId,
          roleId: role.id,
          scopeType: input.scopeType,
          scopeDepartmentId,
          durationDays,
          justification: input.justification,
        })
        .returning();
      const reference = formatRequestNumber(req!.number);
      const started = await this.ctx.workflows.start(
        ACCESS_REQUEST_TRIGGER,
        {
          subject: {
            type: 'access-request',
            id: req!.id,
            label: `${reference} · ${row.appKey === PLATFORM_APP_KEY ? '' : `${row.appName} · `}${role.name} — ${beneficiary.name}`,
            href: `/requests/${reference}`,
          },
          facts: {
            role: {
              id: role.id,
              key: role.key,
              name: role.name,
              riskLevel: role.riskLevel,
              ownerId: role.ownerId,
              application: row.appKey,
            },
            request: {
              durationDays,
              permanent: durationDays === null,
              scopeType: input.scopeType,
              forSomeoneElse: beneficiaryId !== me,
              justification: input.justification,
            },
          },
          requesterId: me,
          subjectUserId: beneficiaryId,
          definitionId: role.requestWorkflowId,
        },
        { tx },
      );
      await tx
        .update(accessRequests)
        .set({ workflowInstanceId: started?.instanceId ?? null })
        .where(eq(accessRequests.id, req!.id));
      const evt = { requestId: req!.id, number: req!.number, roleId: role.id, beneficiaryId };
      await this.ctx.audit.record(
        {
          action: 'core.access-request.submitted',
          category: 'security',
          entityType: 'access_request',
          entityId: req!.id,
          entityLabel: `${reference} ${role.name}`,
          metadata: { ...evt, durationDays, scopeType: input.scopeType, justification: input.justification },
        },
        { tx },
      );
      await this.ctx.events.publish('core.access-request.submitted', evt, { tx });
      return req!;
    });
    return this.get(created.id, auth);
  }

  /** Workflow completion → grant (or record the rejection). Idempotent: only pending requests change. */
  async onWorkflowCompleted(result: WorkflowCompletion) {
    const [req] = await this.db.select().from(accessRequests).where(eq(accessRequests.id, result.subjectId));
    if (!req || req.status !== 'pending') return;
    const [role] = await this.db
      .select({ id: roles.id, name: roles.name, key: roles.key })
      .from(roles)
      .where(eq(roles.id, req.roleId));
    const reference = formatRequestNumber(req.number);
    const evt = {
      requestId: req.id,
      number: req.number,
      roleId: req.roleId,
      beneficiaryId: req.beneficiaryId,
    };
    const recipients = [req.requesterId, req.beneficiaryId];

    if (result.outcome !== 'approved') {
      const status = result.outcome === 'rejected' ? 'rejected' : 'cancelled';
      await this.ctx.transaction(async (tx) => {
        await tx
          .update(accessRequests)
          .set({ status, decidedAt: new Date() })
          .where(eq(accessRequests.id, req.id));
        await this.ctx.audit.record(
          {
            action: `core.access-request.${status}`,
            category: 'security',
            entityType: 'access_request',
            entityId: req.id,
            entityLabel: `${reference} ${role?.name ?? ''}`,
            metadata: { comment: result.comment },
          },
          { tx },
        );
        await this.ctx.events.publish(`core.access-request.${status}`, evt, { tx });
        if (status === 'rejected')
          await this.ctx.notifications.notify(
            {
              type: 'core.access-request.rejected',
              recipients,
              params: { reference, role: role?.name ?? '', comment: result.comment ?? '' },
              href: `/requests/${reference}`,
            },
            { tx },
          );
      });
      return;
    }

    const [beneficiary] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, req.beneficiaryId));
    // Pre-boarded people are granted too (the grant waits for their first day); suspended or gone people aren't.
    const refusal = beneficiary ? beneficiaryRefusal(beneficiary.status) : null;
    if (!role || !beneficiary || refusal) {
      const reason = !role ? 'role_deleted' : (refusal?.reason ?? 'beneficiary_offboarded');
      await this.ctx.transaction(async (tx) => {
        await tx
          .update(accessRequests)
          .set({ status: 'failed', failureReason: reason, decidedAt: new Date() })
          .where(eq(accessRequests.id, req.id));
        await this.ctx.audit.record(
          {
            action: 'core.access-request.failed',
            category: 'security',
            outcome: 'failure',
            entityType: 'access_request',
            entityId: req.id,
            entityLabel: reference,
            metadata: { reason },
          },
          { tx },
        );
        await this.ctx.events.publish('core.access-request.failed', { ...evt, reason }, { tx });
        await this.ctx.notifications.notify(
          {
            type: 'core.access-request.failed',
            recipients: [req.requesterId],
            params: { reference, role: role?.name ?? '' },
            href: `/requests/${reference}`,
          },
          { tx },
        );
      });
      return;
    }

    const expiresAt = req.durationDays ? new Date(Date.now() + req.durationDays * DAY) : null;
    await this.ctx.transaction(async (tx) => {
      const [assignment] = await tx
        .insert(roleAssignments)
        .values({
          roleId: req.roleId,
          userId: req.beneficiaryId,
          scopeType: req.scopeType,
          scopeDepartmentId: req.scopeDepartmentId,
          expiresAt,
          source: 'request',
          reason: `${reference}: ${req.justification}`.slice(0, 1000),
          grantedBy: req.requesterId,
        })
        .onConflictDoUpdate({
          target: [
            roleAssignments.roleId,
            roleAssignments.userId,
            roleAssignments.groupId,
            roleAssignments.scopeType,
            roleAssignments.scopeDepartmentId,
            roleAssignments.scopeRecordType,
            roleAssignments.scopeRecordId,
          ],
          set: { expiresAt, source: 'request', grantedAt: new Date(), expiryNotifiedAt: null },
        })
        .returning();
      await tx
        .update(accessRequests)
        .set({ status: 'approved', assignmentId: assignment!.id, expiresAt, decidedAt: new Date() })
        .where(eq(accessRequests.id, req.id));
      await this.ctx.audit.record(
        {
          action: 'core.role-assignment.granted',
          category: 'security',
          entityType: 'user',
          entityId: req.beneficiaryId,
          metadata: {
            assignmentId: assignment!.id,
            role: role.key,
            scopeType: req.scopeType,
            expiresAt: expiresAt?.toISOString() ?? null,
            request: reference,
          },
        },
        { tx },
      );
      await this.ctx.audit.record(
        {
          action: 'core.access-request.approved',
          category: 'security',
          entityType: 'access_request',
          entityId: req.id,
          entityLabel: `${reference} ${role.name}`,
          metadata: { assignmentId: assignment!.id, expiresAt: expiresAt?.toISOString() ?? null },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.role-assignment.granted',
        { assignmentId: assignment!.id, roleId: role.id },
        { tx },
      );
      await this.ctx.events.publish(
        'core.access-request.approved',
        { ...evt, assignmentId: assignment!.id },
        { tx },
      );
      await this.ctx.notifications.notify(
        {
          type: 'core.access-request.approved',
          recipients,
          params: { reference, role: role.name, expiresAt, permanent: expiresAt ? 'no' : 'yes' },
          href: `/requests/${reference}`,
        },
        { tx },
      );
    });
    await getKernel().rbac.bump();
  }

  async cancel(id: string, reason: string | null | undefined, auth: AuthContext) {
    const [req] = await this.db.select().from(accessRequests).where(eq(accessRequests.id, id));
    if (!req) throw httpErrors.notFound('Request not found');
    const me = auth.user?.id;
    if (req.requesterId !== me && req.beneficiaryId !== me && !auth.can('core.workflows.manage'))
      throw httpErrors.forbidden();
    if (req.status !== 'pending')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Only pending requests can be cancelled');
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(accessRequests)
        .set({ status: 'cancelled', decidedAt: new Date() })
        .where(eq(accessRequests.id, id));
      if (req.workflowInstanceId)
        await this.ctx.workflows.cancel(req.workflowInstanceId, reason ?? null, { tx });
      await this.ctx.audit.record(
        {
          action: 'core.access-request.cancelled',
          category: 'security',
          entityType: 'access_request',
          entityId: id,
          entityLabel: formatRequestNumber(req.number),
          metadata: { reason: reason ?? null },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.access-request.cancelled',
        { requestId: id, number: req.number, roleId: req.roleId, beneficiaryId: req.beneficiaryId },
        { tx },
      );
    });
    return this.get(id, auth);
  }

  private async canView(req: RequestRow, auth: AuthContext) {
    const me = auth.user?.id;
    if (me && (req.requesterId === me || req.beneficiaryId === me)) return true;
    if (auth.can('core.access-requests.read') || auth.can('core.workflows.read')) return true;
    if (auth.permissions.hasAny('core.access-requests.read')) {
      const [b] = await this.db
        .select({ d: users.departmentId })
        .from(users)
        .where(eq(users.id, req.beneficiaryId));
      if (auth.can('core.access-requests.read', { departmentId: b?.d ?? null })) return true;
    }
    return Boolean(
      me && req.workflowInstanceId && (await getKernel().workflows.involves(req.workflowInstanceId, me)),
    );
  }

  private async dtos(rows: RequestRow[], auth: AuthContext) {
    if (!rows.length) return [];
    const roleRows = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        moduleId: roles.moduleId,
        riskLevel: roles.riskLevel,
        appKey: applications.key,
        appName: applications.name,
      })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .where(inArray(roles.id, [...new Set(rows.map((r) => r.roleId))]));
    const deptIds = rows.map((r) => r.scopeDepartmentId).filter((x): x is string => Boolean(x));
    const depts = deptIds.length
      ? await this.db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(inArray(departments.id, deptIds))
      : [];
    const people = await peopleById(
      this.db,
      rows.flatMap((r) => [r.requesterId, r.beneficiaryId]),
    );
    const instances = await this.db
      .select()
      .from(workflowInstances)
      .where(
        inArray(
          workflowInstances.id,
          rows
            .map((r) => r.workflowInstanceId)
            .filter((x): x is string => Boolean(x))
            .concat('00000000-0000-0000-0000-000000000000'),
        ),
      );
    const summaries = await this.views.summaries(instances);
    const me = auth.user?.id;
    return rows.map((r) => {
      const role = roleRows.find((x) => x.id === r.roleId);
      return {
        id: r.id,
        number: r.number,
        reference: formatRequestNumber(r.number),
        role: {
          id: r.roleId,
          key: role?.key ?? '?',
          name: role?.name ?? '?',
          description: role?.description ?? null,
          moduleId: role?.moduleId ?? null,
          riskLevel: role?.riskLevel ?? 'low',
          application: { key: role?.appKey ?? '?', name: role?.appName ?? '?' },
        },
        requester: ref(people, r.requesterId),
        beneficiary: ref(people, r.beneficiaryId)!,
        scopeType: r.scopeType,
        scopeDepartment: r.scopeDepartmentId
          ? { id: r.scopeDepartmentId, name: depts.find((d) => d.id === r.scopeDepartmentId)?.name ?? '?' }
          : null,
        durationDays: r.durationDays,
        justification: r.justification,
        status: r.status,
        failureReason: r.failureReason,
        expiresAt: r.expiresAt,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
        workflow: r.workflowInstanceId ? (summaries.get(r.workflowInstanceId) ?? null) : null,
        canCancel: r.status === 'pending' && (r.requesterId === me || r.beneficiaryId === me),
      };
    });
  }

  async get(id: string, auth: AuthContext) {
    const [req] = await this.db.select().from(accessRequests).where(eq(accessRequests.id, id));
    if (!req || !(await this.canView(req, auth))) throw httpErrors.notFound('Request not found');
    return (await this.dtos([req], auth))[0]!;
  }

  async byNumber(number: number, auth: AuthContext) {
    const [req] = await this.db
      .select({ id: accessRequests.id })
      .from(accessRequests)
      .where(eq(accessRequests.number, number));
    return req ? this.get(req.id, auth) : null;
  }

  /** The approval path of any workflow instance the viewer may see (requesters, approvers, workflow readers). */
  instancePath(instanceId: string, auth: AuthContext) {
    return requestPath(this.ctx, instanceId, auth);
  }

  /** The approval path of a request by its number, as the requester sees it; null when the viewer can't see it. */
  async pathByNumber(number: number, auth: AuthContext) {
    const req = await this.byNumber(number, auth);
    if (!req) return null;
    return req.workflow ? requestPath(this.ctx, req.workflow.id, auth) : NO_APPROVAL_PATH;
  }

  async list(q: z.output<typeof accessRequestQuerySchema>, auth: AuthContext) {
    const me = auth.user!.id;
    let scope;
    if (q.scope === 'mine')
      scope = or(eq(accessRequests.requesterId, me), eq(accessRequests.beneficiaryId, me));
    else {
      const reach = auth.reach('core.access-requests.read');
      if (!reach.global && !reach.departmentIds.length) throw httpErrors.forbidden();
      scope = reach.global
        ? undefined
        : inArray(
            accessRequests.beneficiaryId,
            this.db
              .select({ id: users.id })
              .from(users)
              .where(inArray(users.departmentId, reach.departmentIds)),
          );
    }
    const where = and(
      scope,
      q.status ? eq(accessRequests.status, q.status) : undefined,
      q.roleId ? eq(accessRequests.roleId, q.roleId) : undefined,
      q.q
        ? inArray(
            accessRequests.roleId,
            this.db
              .select({ id: roles.id })
              .from(roles)
              .where(ilike(roles.name, likePattern(q.q))),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(accessRequests)
        .where(where)
        .orderBy(desc(accessRequests.createdAt))
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(accessRequests).where(where),
    ]);
    return { items: await this.dtos(rows, auth), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  /** "My requests": access requests (asked by or for me) and my form submissions, newest first. */
  async mine(q: z.output<typeof myRequestQuerySchema>, auth: AuthContext) {
    const me = auth.user!.id;
    const open = q.status === 'open';
    const closed = q.status === 'closed';
    const accessStatus = open ? sql`ar.status = 'pending'` : closed ? sql`ar.status <> 'pending'` : sql`true`;
    // A form request stays open while a module is still fulfilling it.
    const formOpen = sql`(fs.status in ('pending', 'submitted') or (fs.status = 'approved' and fs.fulfilment->>'state' = 'open'))`;
    const formStatus = open ? formOpen : closed ? sql`not ${formOpen}` : sql`true`;
    const moduleStatus = open ? sql`pi.state = 'open'` : closed ? sql`pi.state = 'closed'` : sql`true`;
    const enabled = getKernel()
      .registry.enabledModules()
      .map((m) => m.manifest.id);
    const like = q.q ? likePattern(q.q) : null;
    const union = sql`
      select 'access' as kind, ar.id::text as id, ar.number, ar.status, ar.created_at, ar.updated_at,
             ar.workflow_instance_id, null::jsonb as fulfilment, null::text as kind_key
        from core.access_requests ar join core.roles r on r.id = ar.role_id
       where (ar.requester_id = ${me} or ar.beneficiary_id = ${me}) and ${accessStatus}
         ${like ? sql`and (r.name ilike ${like} or ('REQ-' || lpad(ar.number::text, 5, '0')) ilike ${like})` : sql``}
      union all
      select 'form' as kind, fs.id::text, fs.number, fs.status, fs.created_at, fs.updated_at,
             fs.workflow_instance_id, fs.fulfilment, null::text
        from core.form_submissions fs join core.forms f on f.id = fs.form_id
       where fs.submitted_by = ${me} and ${formStatus}
         ${like ? sql`and (f.name->>'en' ilike ${like} or f.name->>'zh-TW' ilike ${like} or f.name->>'ja-JP' ilike ${like} or fs.fulfilment->>'reference' ilike ${like} or ('REQ-' || lpad(fs.number::text, 5, '0')) ilike ${like})` : sql``}
      union all
      select 'module' as kind, pi.entity_id, null::bigint, pi.state, pi.created_at, pi.updated_at,
             null::uuid, null::jsonb, pi.kind
        from core.portal_items pi
       where pi.people @> ${`{${me}}`}::uuid[] and ${moduleStatus}
         and pi.module_id in (${sql.join(
           enabled.map((id) => sql`${id}`),
           sql`, `,
         )})
         ${like ? sql`and (pi.reference ilike ${like} or pi.title::text ilike ${like})` : sql``}`;
    const [page, totalRes] = await Promise.all([
      this.db.execute<{
        kind: 'access' | 'form' | 'module';
        id: string;
        number: string | null;
        status: string;
        created_at: Date;
        updated_at: Date;
        workflow_instance_id: string | null;
        fulfilment: SubmissionFulfilment | null;
        kind_key: string | null;
      }>(sql`${union} order by created_at desc limit ${q.pageSize} offset ${pageOffset(q.page, q.pageSize)}`),
      this.db.execute<{ n: number }>(sql`select count(*)::int as n from (${union}) x`),
    ]);
    const rows = page.rows;
    const accessIds = rows.filter((r) => r.kind === 'access').map((r) => r.id);
    const formIds = rows.filter((r) => r.kind === 'form').map((r) => r.id);
    const moduleKeys = rows.filter((r) => r.kind === 'module');
    const [accessInfo, formInfo, instances, moduleInfo] = await Promise.all([
      accessIds.length
        ? this.db
            .select({
              id: accessRequests.id,
              roleName: roles.name,
              roleKey: roles.key,
              roleModuleId: roles.moduleId,
              appKey: applications.key,
              appName: applications.name,
              beneficiaryId: accessRequests.beneficiaryId,
            })
            .from(accessRequests)
            .innerJoin(roles, eq(roles.id, accessRequests.roleId))
            .innerJoin(applications, eq(applications.id, roles.applicationId))
            .where(inArray(accessRequests.id, accessIds))
        : Promise.resolve([]),
      formIds.length
        ? this.db
            .select({ id: formSubmissions.id, name: forms.name, icon: forms.icon })
            .from(formSubmissions)
            .innerJoin(forms, eq(forms.id, formSubmissions.formId))
            .where(inArray(formSubmissions.id, formIds))
        : Promise.resolve([]),
      this.db
        .select()
        .from(workflowInstances)
        .where(
          inArray(
            workflowInstances.id,
            rows
              .map((r) => r.workflow_instance_id)
              .filter((x): x is string => Boolean(x))
              .concat('00000000-0000-0000-0000-000000000000'),
          ),
        ),
      moduleKeys.length
        ? this.db
            .select()
            .from(portalItems)
            .where(
              or(
                ...moduleKeys.map((r) =>
                  and(eq(portalItems.kind, r.kind_key!), eq(portalItems.entityId, r.id)),
                ),
              ),
            )
        : Promise.resolve([]),
    ]);
    const summaries = await this.views.summaries(instances);
    const people = await peopleById(
      this.db,
      accessInfo.map((a) => a.beneficiaryId),
    );
    const roleTitles = new Map(
      await Promise.all(
        accessInfo.map(async (a) => [a.id, await roleTitle(a.roleModuleId, a.roleKey, a.roleName)] as const),
      ),
    );
    return {
      items: rows.map((r) => {
        const wf = r.workflow_instance_id ? summaries.get(r.workflow_instance_id) : null;
        const workflow = wf
          ? { status: wf.status, currentSteps: wf.currentSteps, pendingWith: wf.pendingWith }
          : null;
        const base = {
          id: r.id,
          number: r.number == null ? null : Number(r.number),
          reference: r.number == null ? '' : formatRequestNumber(Number(r.number)),
          status: r.status,
          statusKey: null,
          tone: null,
          href: null,
          moduleId: null,
          fulfilment: r.fulfilment
            ? {
                moduleId: r.fulfilment.moduleId,
                reference: r.fulfilment.reference,
                href: r.fulfilment.href,
                state: r.fulfilment.state,
                statusKey: r.fulfilment.statusKey,
                tone: r.fulfilment.tone ?? null,
                updatedAt: new Date(r.fulfilment.updatedAt),
              }
            : null,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          workflow,
        };
        if (r.kind === 'module') {
          const m = moduleInfo.find((x) => x.kind === r.kind_key && x.entityId === r.id);
          return {
            ...base,
            kind: 'module' as const,
            reference: m?.reference ?? '',
            title: typeof m?.title === 'string' ? { en: m.title } : (m?.title ?? { en: '?' }),
            subtitle: null,
            icon: m?.icon ?? 'circle-dot',
            statusKey: m?.statusKey ?? null,
            tone: (m?.tone as 'neutral' | 'info' | 'success' | 'warning' | 'danger' | null) ?? null,
            href: m?.href ?? null,
            moduleId: m?.moduleId ?? null,
          };
        }
        if (r.kind === 'access') {
          const a = accessInfo.find((x) => x.id === r.id);
          const forOther = a && a.beneficiaryId !== me ? ref(people, a.beneficiaryId)?.displayName : null;
          return {
            ...base,
            kind: 'access' as const,
            title: roleTitles.get(r.id) ?? { en: a?.roleName ?? '?' },
            subtitle:
              [a && a.appKey !== PLATFORM_APP_KEY ? a.appName : null, forOther].filter(Boolean).join(' · ') ||
              null,
            icon: 'key-round',
          };
        }
        const f = formInfo.find((x) => x.id === r.id);
        return {
          ...base,
          kind: 'form' as const,
          title: f?.name ?? { en: '?' },
          subtitle: null,
          icon: f?.icon ?? 'file-text',
        };
      }),
      total: totalRes.rows[0]?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Tells people a few days ahead that a time-bound grant is ending (once per assignment). A grant to a person
   * reminds that person. A grant to a group reminds the group's members who will actually lose the role: members
   * who keep it through another assignment that lasts longer (their own or another group's, with the same scope or
   * a global one) are left out. Groups have no owners of their own, so nobody else is reminded.
   */
  async notifyExpiring(withinDays = 3): Promise<number> {
    const soon = new Date(Date.now() + withinDays * DAY);
    const rows = await this.db
      .select({
        id: roleAssignments.id,
        roleId: roleAssignments.roleId,
        userId: roleAssignments.userId,
        groupId: roleAssignments.groupId,
        groupName: groups.name,
        scopeType: roleAssignments.scopeType,
        scopeDepartmentId: roleAssignments.scopeDepartmentId,
        scopeRecordType: roleAssignments.scopeRecordType,
        scopeRecordId: roleAssignments.scopeRecordId,
        expiresAt: roleAssignments.expiresAt,
        roleName: roles.name,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .leftJoin(groups, eq(groups.id, roleAssignments.groupId))
      .where(
        and(
          sql`${roleAssignments.expiresAt} > now() and ${roleAssignments.expiresAt} <= ${soon}`,
          isNull(roleAssignments.expiryNotifiedAt),
        ),
      )
      .orderBy(asc(roleAssignments.expiresAt))
      .limit(200);
    for (const r of rows) {
      const recipients = r.userId ? [r.userId] : await this.membersLosing(r);
      await this.ctx.transaction(async (tx) => {
        await tx
          .update(roleAssignments)
          .set({ expiryNotifiedAt: new Date() })
          .where(eq(roleAssignments.id, r.id));
        if (recipients.length)
          await this.ctx.notifications.notify(
            {
              type: 'core.access.expiring',
              recipients,
              params: {
                role: r.roleName,
                expiresAt: r.expiresAt,
                via: r.groupId ? 'group' : 'person',
                group: r.groupName ?? '',
              },
              href: '/requests/access',
              data: { assignmentId: r.id, groupId: r.groupId },
            },
            { tx },
          );
      });
    }
    return rows.length;
  }

  /**
   * Members of an expiring group grant who lose the role with it: not those who hold the same role, with the same
   * scope or globally, through another assignment that is permanent or ends later.
   */
  private async membersLosing(g: {
    id: string;
    roleId: string;
    groupId: string | null;
    scopeType: string;
    scopeDepartmentId: string | null;
    scopeRecordType: string | null;
    scopeRecordId: string | null;
    expiresAt: Date | null;
  }): Promise<string[]> {
    if (!g.groupId) return [];
    const o = roleAssignments;
    const rows = await this.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, g.groupId),
          sql`not exists (
            select 1 from ${o}
             where ${o.roleId} = ${g.roleId}
               and ${o.id} <> ${g.id}
               and (${o.expiresAt} is null or ${o.expiresAt} > ${g.expiresAt})
               and (${o.scopeType} = 'global'
                    or (${o.scopeType} = ${g.scopeType}
                        and ${o.scopeDepartmentId} is not distinct from ${g.scopeDepartmentId}
                        and ${o.scopeRecordType} is not distinct from ${g.scopeRecordType}
                        and ${o.scopeRecordId} is not distinct from ${g.scopeRecordId}))
               and (${o.userId} = ${groupMembers.userId}
                    or ${o.groupId} in (select m.group_id from ${groupMembers} m where m.user_id = ${groupMembers.userId})))`,
        ),
      );
    return rows.map((r) => r.userId);
  }
}
