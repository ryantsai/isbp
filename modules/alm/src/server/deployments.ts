import { groupMembers, roleAssignments, roles } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import type {
  changeUsageSchema,
  createDeploymentSchema,
  deploymentQuerySchema,
  finishDeploymentSchema,
  policyCheckSchema,
  policyQuerySchema,
  recordedDeploymentSchema,
} from '../contracts';
import {
  DEPLOYMENT_TRANSITIONS,
  type DeploymentStatus,
  evaluatePolicy,
  FAILED_STATUSES,
  isProduction,
  OPEN_RELEASE_STATUSES,
  type PolicyChange,
  type PolicyDecision,
  releaseHref,
} from '../model';
import { DEPLOY, OVERRIDE, personOf } from './access';
import { type ApplicationService, auditLabel, invalid } from './applications';
import { findChange, linkedChanges, releasesLinkedTo, toChangeInfo, toPolicyChange } from './changes';
import {
  type AppRow,
  type DeploymentOut,
  type DeploymentRow,
  type EnvRow,
  type ReleaseRow,
  selectDeployments,
  toDeployment,
} from './refs';
import type { ReleaseService } from './releases';
import { applications, deployments, environments, releases, repositories } from './schema';

export const DEPLOYMENT_ENTITY = 'alm.deployment';
type CreateInput = z.output<typeof createDeploymentSchema>;
type RecordedOut = z.output<typeof recordedDeploymentSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Clock skew tolerated for `startedAt` / `finishedAt` sent by pipelines. */
const FUTURE_SLACK_MS = 5 * 60_000;

const SORTABLE: Record<string, SQL> = {
  startedAt: sql`${deployments.startedAt}`,
  finishedAt: sql`${deployments.finishedAt}`,
  status: sql`${deployments.status}`,
  version: sql`${deployments.version}`,
};

const deploymentLabel = (app: { code: string }, env: { name: string }, version: string) =>
  `${app.code} ${version} → ${env.name}`;

/**
 * Deployment records and the change policy. `record` is what the "Record deployment" dialog, the CI/CD
 * API (`POST /deployments` with an API key) and the `alm.record_deployment` AI tool all call.
 */
export class DeploymentService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly apps: ApplicationService,
    private readonly releases: ReleaseService,
  ) {}

  /* ───────────── reading ───────────── */

  async list(q: z.output<typeof deploymentQuerySchema>) {
    const app = q.application ? await this.apps.resolve(q.application) : null;
    const where = and(
      app ? eq(deployments.applicationId, app.id) : undefined,
      q.environment ? eq(deployments.environmentId, q.environment) : undefined,
      q.kind ? eq(environments.kind, q.kind) : undefined,
      q.release ? eq(deployments.releaseId, q.release) : undefined,
      q.status?.length ? inArray(deployments.status, q.status) : undefined,
      q.from ? gte(deployments.startedAt, q.from) : undefined,
      q.to ? lt(deployments.startedAt, q.to) : undefined,
      q.q
        ? or(
            ilike(deployments.version, likePattern(q.q)),
            ilike(deployments.changeReference, likePattern(q.q)),
            ilike(deployments.actorName, likePattern(q.q)),
          )
        : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'startedAt';
    const column = SORTABLE[key] ?? SORTABLE.startedAt!;
    const order = q.sort ? (q.sort.startsWith('-') ? desc(column) : asc(column)) : desc(column);
    const [rows, [total]] = await Promise.all([
      selectDeployments(this.ctx.db)
        .where(where)
        .orderBy(order, desc(deployments.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db
        .select({ n: count() })
        .from(deployments)
        .innerJoin(environments, eq(environments.id, deployments.environmentId))
        .where(where),
    ]);
    return { items: rows.map(toDeployment), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, db: Db = this.ctx.db): Promise<DeploymentOut> {
    if (!UUID_RE.test(id)) throw httpErrors.notFound('Deployment not found');
    const [row] = await selectDeployments(db).where(eq(deployments.id, id));
    if (!row) throw httpErrors.notFound('Deployment not found');
    return toDeployment(row);
  }

  /** Environment by name ("Production", case-insensitive) or kind (`production`, the first one). */
  async environment(app: AppRow, nameOrKind: string): Promise<EnvRow> {
    const rows = await this.ctx.db
      .select()
      .from(environments)
      .where(eq(environments.applicationId, app.id))
      .orderBy(asc(environments.sort), asc(environments.createdAt));
    const wanted = nameOrKind.trim().toLowerCase();
    const env =
      rows.find((e) => e.name.toLowerCase() === wanted) ??
      (UUID_RE.test(wanted) ? rows.find((e) => e.id === wanted) : undefined) ??
      rows.find((e) => e.kind === wanted);
    if (!env)
      throw invalid('environment', `"${app.code}" has no environment named or of kind "${nameOrKind}"`);
    return env;
  }

  /* ───────────── recording ───────────── */

  /**
   * Records a deployment. Production deployments meet the change policy (`evaluatePolicy`): refused with
   * 409 `CHANGE_REQUIRED` (`details.reason`) unless an authorized change is named or linked to the release —
   * or the caller holds `alm.deployments.override` and gives a reason (audited as a security event and
   * notified to the change managers).
   */
  async record(
    input: CreateInput,
    auth: AuthContext,
    opts: { allowOverride?: boolean } = {},
  ): Promise<RecordedOut> {
    auth.require(DEPLOY);
    if (input.override) {
      if (opts.allowOverride === false)
        throw httpErrors.badRequest('The change policy cannot be overridden here');
      auth.require(OVERRIDE);
    }
    const now = new Date();
    if (input.startedAt && input.startedAt.getTime() > now.getTime() + FUTURE_SLACK_MS)
      throw invalid('startedAt', 'The deployment cannot start in the future');
    if (input.finishedAt && input.finishedAt.getTime() > now.getTime() + FUTURE_SLACK_MS)
      throw invalid('finishedAt', 'The deployment cannot finish in the future');

    const { app, env, release, named, linked, decision } = await this.prepare(
      { ...input, override: Boolean(input.override) },
      now,
    );
    if ((input.changeId || input.changeReference) && !named)
      throw invalid(input.changeId ? 'changeId' : 'changeReference', 'No such change in the service desk');
    if (decision.outcome === 'deny') throw this.refused(decision, auth, now, [named, ...linked]);

    // The change snapshot: the authorizing change in production; elsewhere only one the caller named.
    const change = decision.applies ? decision.change : named ? toPolicyChange(named, true) : null;
    const finished = input.status !== 'in_progress';
    const finishedAt = finished ? (input.finishedAt ?? now) : null;
    const startedAt = input.startedAt ?? finishedAt ?? now;
    if (finishedAt && startedAt > finishedAt)
      throw invalid('finishedAt', 'finishedAt must not be before startedAt');
    const actor = actorOf(auth);

    const id = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(deployments)
        .values({
          applicationId: app.id,
          environmentId: env.id,
          releaseId: release?.id ?? null,
          version: input.version,
          status: input.status,
          startedAt,
          finishedAt,
          deployedBy: personOf(auth),
          actorName: actor,
          source: auth.principal.type === 'user' ? 'manual' : 'api',
          changeId: change?.id ?? null,
          changeReference: change?.reference ?? null,
          overrideReason: decision.outcome === 'override' ? input.override!.reason : null,
          policyWarning: decision.warning,
          commitSha: input.commitSha ?? null,
          pipelineUrl: input.pipelineUrl ?? null,
          notes: input.notes || null,
        })
        .returning();
      const d = row!;
      const ref = this.ref(app, env, d);
      await this.ctx.audit.record(
        {
          action: 'alm.deployment.recorded',
          entityType: DEPLOYMENT_ENTITY,
          entityId: d.id,
          entityLabel: deploymentLabel(app, env, d.version),
          metadata: {
            application: auditLabel(app),
            environment: env.name,
            kind: env.kind,
            version: d.version,
            status: d.status,
            source: d.source,
            change: d.changeReference,
            policy: decision.outcome,
            warning: decision.warning,
          },
        },
        { tx },
      );
      await this.ctx.events.publish('alm.deployment.recorded', { ...ref, warning: decision.warning }, { tx });
      if (decision.outcome === 'override') await this.overridden(tx, app, env, d, decision, actor);
      if (finished && input.commitSha && input.status === 'succeeded')
        await this.noteCommit(tx, app, input, finishedAt ?? startedAt, actor);
      await this.afterOutcome(tx, app, env, d, release);
      return d.id;
    });
    return {
      ...(await this.get(id)),
      policy: {
        outcome: decision.outcome as RecordedOut['policy']['outcome'],
        applies: decision.applies,
        warning: decision.warning,
        reason: decision.reason,
      },
    };
  }

  /** Resolves what a deployment is about and evaluates the change policy for it (no writes). */
  private async prepare(
    input: {
      application: string;
      environment: string;
      version?: string | null;
      changeId?: string | null;
      changeReference?: string | null;
      override?: boolean;
    },
    now: Date,
  ) {
    const app = await this.apps.resolve(input.application);
    const env = await this.environment(app, input.environment);
    const release = input.version ? await this.releases.byVersion(app.id, input.version) : null;
    const named =
      input.changeId || input.changeReference
        ? await findChange(this.ctx.db, { id: input.changeId, reference: input.changeReference })
        : null;
    const linked = release ? await linkedChanges(this.ctx, release.id, now) : [];
    const candidates: PolicyChange[] = [
      ...(named ? [toPolicyChange(named, true)] : []),
      ...linked.filter((c) => c.id !== named?.id).map((c) => toPolicyChange(c)),
    ];
    const settings = await this.releases.policySettings();
    const decision = evaluatePolicy({
      environmentKind: env.kind,
      settings,
      changes: candidates,
      now,
      override: input.override,
    });
    return { app, env, release, named, linked, decision, settings };
  }

  /** Dry run of the change policy, for the "Record deployment" dialog's live explanation. */
  async policy(
    q: z.output<typeof policyQuerySchema>,
    auth: AuthContext,
  ): Promise<z.output<typeof policyCheckSchema>> {
    const now = new Date();
    const { env, release, named, linked, decision, settings } = await this.prepare(q, now);
    const titles = new Map([...linked, ...(named ? [named] : [])].map((c) => [c.id, c.title]));
    return {
      environment: { id: env.id, name: env.name, kind: env.kind },
      release: release ? { id: release.id, version: release.version } : null,
      requireChange: settings.requireChange,
      enforceWindow: settings.enforceWindow,
      decision: {
        ...decision,
        change: decision.change ? toChangeInfo(decision.change, now, titles.get(decision.change.id)) : null,
      },
      changes: linked.map((c) => toChangeInfo(c, now)),
      named: named ? toChangeInfo(named, now) : null,
      namedNotFound: Boolean(q.changeReference && !named),
      canOverride: auth.can(OVERRIDE),
    };
  }

  /** 409 `CHANGE_REQUIRED` with what the UI needs to explain it. */
  private refused(
    decision: PolicyDecision,
    auth: AuthContext,
    now: Date,
    rows: (Parameters<typeof toChangeInfo>[0] | null)[],
  ): HttpError {
    const titles = new Map(
      rows
        .filter((r): r is NonNullable<typeof r> => Boolean(r && 'title' in r))
        .map((r) => [r.id, (r as { title: string }).title]),
    );
    const message = {
      no_change: 'A production deployment needs an authorized change: name one or link it to the release',
      change_not_approved: 'The change is not approved yet (it must be scheduled or implementing)',
      outside_window: 'Now is outside the planned window of the change',
    }[decision.reason!];
    return new HttpError(409, ErrorCodes.CHANGE_REQUIRED, message, {
      reason: decision.reason,
      change: decision.change ? toChangeInfo(decision.change, now, titles.get(decision.change.id)) : null,
      canOverride: auth.can(OVERRIDE),
    });
  }

  private async overridden(
    tx: Db,
    app: AppRow,
    env: EnvRow,
    d: DeploymentRow,
    decision: PolicyDecision,
    actor: string,
  ) {
    await this.ctx.audit.record(
      {
        action: 'alm.deployment.policy_overridden',
        category: 'security',
        entityType: DEPLOYMENT_ENTITY,
        entityId: d.id,
        entityLabel: deploymentLabel(app, env, d.version),
        metadata: {
          application: auditLabel(app),
          environment: env.name,
          version: d.version,
          policyReason: decision.reason,
          change: decision.change?.reference ?? null,
          overrideReason: d.overrideReason,
        },
      },
      { tx },
    );
    await this.ctx.events.publish(
      'alm.deployment.policy_overridden',
      { ...this.ref(app, env, d), reason: decision.reason!, overrideReason: d.overrideReason! },
      { tx },
    );
    await this.ctx.notifications.notify(
      {
        type: 'alm.deployment.overridden',
        recipients: await this.changeManagers(tx),
        params: {
          application: app.name,
          version: d.version,
          environment: env.name,
          actor,
          reason: decision.reason!,
          change: decision.change?.reference ?? '',
          overrideReason: d.overrideReason ?? '',
        },
        href: this.href(app, d),
      },
      { tx },
    );
  }

  /** Holders of the ITSM change manager role (directly or through a group), for override notices. */
  private async changeManagers(db: Db): Promise<string[]> {
    const rows = await db
      .select({ userId: roleAssignments.userId, memberId: groupMembers.userId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .leftJoin(groupMembers, eq(groupMembers.groupId, roleAssignments.groupId))
      .where(
        and(
          eq(roles.key, 'itsm-change-manager'),
          or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, new Date())),
        ),
      );
    return [...new Set(rows.map((r) => r.userId ?? r.memberId).filter((x): x is string => Boolean(x)))];
  }

  /** The commit a successful deployment shipped becomes the repository's last known commit. */
  private async noteCommit(tx: Db, app: AppRow, input: CreateInput, at: Date, actor: string) {
    const repos = await tx.select().from(repositories).where(eq(repositories.applicationId, app.id));
    const wanted = input.repository?.trim().toLowerCase();
    const repo = wanted
      ? repos.find((r) => r.name.toLowerCase() === wanted || r.url.toLowerCase() === wanted)
      : repos.length === 1
        ? repos[0]
        : undefined;
    if (!repo) return;
    if (repo.lastCommitAt && repo.lastCommitAt > at) return;
    await tx
      .update(repositories)
      .set({
        lastCommitSha: input.commitSha!,
        lastCommitAt: at,
        lastCommitMessage: input.notes?.split('\n')[0]?.slice(0, 500) ?? null,
        lastCommitAuthor: actor,
      })
      .where(eq(repositories.id, repo.id));
  }

  /* ───────────── finishing ───────────── */

  async finish(id: string, input: z.output<typeof finishDeploymentSchema>, auth: AuthContext) {
    auth.require(DEPLOY);
    const before = await this.get(id);
    const allowed = DEPLOYMENT_TRANSITIONS[before.status];
    if (!allowed.includes(input.status))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_TRANSITION,
        `A ${before.status} deployment cannot become ${input.status}`,
        {
          from: before.status,
          allowed,
        },
      );
    const now = new Date();
    const finishedAt = input.finishedAt ?? now;
    if (finishedAt.getTime() > now.getTime() + FUTURE_SLACK_MS)
      throw invalid('finishedAt', 'The deployment cannot finish in the future');
    if (finishedAt < before.startedAt) throw invalid('finishedAt', 'finishedAt must not be before startedAt');
    const app = await this.apps.resolve(before.application.id);
    await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(deployments)
        .set({
          status: input.status,
          // A rollback of a finished deployment keeps when it finished; the notes say when it was undone.
          finishedAt: before.status === 'in_progress' ? finishedAt : (before.finishedAt ?? finishedAt),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        })
        .where(and(eq(deployments.id, before.id), eq(deployments.status, before.status)))
        .returning();
      if (!row) throw new HttpError(409, ErrorCodes.CONFLICT, 'The deployment changed meanwhile; reload it');
      const [env] = await tx.select().from(environments).where(eq(environments.id, row.environmentId));
      const release = row.releaseId ? await this.releases.resolve(row.releaseId, tx) : null;
      await this.ctx.audit.record(
        {
          action: 'alm.deployment.updated',
          entityType: DEPLOYMENT_ENTITY,
          entityId: row.id,
          entityLabel: deploymentLabel(app, env!, row.version),
          changes: { status: [before.status, row.status] },
        },
        { tx },
      );
      await this.afterOutcome(tx, app, env!, row, release);
    });
    return this.get(id);
  }

  /**
   * In the deployment's transaction: refresh the environment's denormalized state; on success to
   * production release the release; on failure tell the technical owner and the team.
   */
  private async afterOutcome(tx: Db, app: AppRow, env: EnvRow, d: DeploymentRow, release: ReleaseRow | null) {
    await refreshEnvironment(tx, env.id);
    const ref = this.ref(app, env, d);
    if (d.status === 'succeeded') {
      await this.ctx.events.publish('alm.deployment.succeeded', ref, { tx });
      if (isProduction(env.kind) && release && OPEN_RELEASE_STATUSES.includes(release.status))
        await this.releases.move(tx, app, release, 'released', d.finishedAt ?? d.startedAt, {
          reason: 'deployed_to_production',
          deploymentId: d.id,
        });
    } else if (FAILED_STATUSES.includes(d.status)) {
      await this.ctx.events.publish('alm.deployment.failed', ref, { tx });
      const team = app.teamGroupId
        ? await tx
            .select({ id: groupMembers.userId })
            .from(groupMembers)
            .where(eq(groupMembers.groupId, app.teamGroupId))
        : [];
      await this.ctx.notifications.notify(
        {
          type: 'alm.deployment.failed',
          recipients: [app.technicalOwnerId, ...team.map((m) => m.id)],
          params: {
            application: app.name,
            code: app.code,
            version: d.version,
            environment: env.name,
            status: d.status,
            actor: d.actorName,
          },
          href: this.href(app, d),
        },
        { tx },
      );
    }
    if (release && d.status !== 'in_progress') await this.releases.checkReady(release.id, tx);
  }

  private href(app: AppRow, d: DeploymentRow) {
    return d.releaseId ? releaseHref(app.code, d.version) : `/alm/${app.code}?tab=deployments`;
  }

  private ref(app: AppRow, env: EnvRow, d: DeploymentRow) {
    return {
      applicationId: app.id,
      code: app.code,
      name: app.name,
      deploymentId: d.id,
      environmentId: env.id,
      environment: env.name,
      kind: env.kind,
      version: d.version,
      status: d.status,
      releaseId: d.releaseId,
      changeReference: d.changeReference,
    };
  }

  /* ───────────── ITSM change page slot ───────────── */

  /** The releases linked to a change and the deployments it authorized. */
  async forChange(changeId: string): Promise<z.output<typeof changeUsageSchema>> {
    if (!UUID_RE.test(changeId)) return { releases: [], deployments: [] };
    const releaseIds = await releasesLinkedTo(this.ctx, changeId);
    const [rels, deps] = await Promise.all([
      releaseIds.length
        ? this.ctx.db
            .select({
              id: releases.id,
              version: releases.version,
              status: releases.status,
              appId: applications.id,
              code: applications.code,
              name: applications.name,
            })
            .from(releases)
            .innerJoin(applications, eq(applications.id, releases.applicationId))
            .where(inArray(releases.id, releaseIds))
            .orderBy(asc(applications.code), asc(releases.version))
        : Promise.resolve([]),
      selectDeployments(this.ctx.db)
        .where(eq(deployments.changeId, changeId))
        .orderBy(desc(deployments.startedAt))
        .limit(50),
    ]);
    return {
      releases: rels.map((r) => ({
        id: r.id,
        version: r.version,
        status: r.status,
        application: { id: r.appId, code: r.code, name: r.name },
      })),
      deployments: deps.map((r) => ({
        id: r.d.id,
        application: { id: r.d.applicationId, code: r.appCode, name: r.appName },
        environment: { id: r.d.environmentId, name: r.envName, kind: r.envKind },
        version: r.d.version,
        status: r.d.status,
        startedAt: r.d.startedAt,
        finishedAt: r.d.finishedAt,
        overridden: Boolean(r.d.overrideReason),
      })),
    };
  }
}

/** Who recorded it: the person, the API client's name, or the AI agent (on behalf of someone). */
export function actorOf(auth: AuthContext): string {
  if (auth.user) return auth.user.displayName;
  if (auth.client) return auth.client.name;
  const p = auth.principal;
  return p.onBehalfOf ? `${p.name} (${p.onBehalfOf.name})` : p.name;
}

/**
 * Recomputes an environment's denormalized state from its deployments: the last one (any status) and the
 * current version (the latest success — a rolled-back deployment no longer counts).
 */
export async function refreshEnvironment(tx: Db, environmentId: string) {
  const [[last], [current]] = await Promise.all([
    tx
      .select({
        id: deployments.id,
        status: deployments.status,
        startedAt: deployments.startedAt,
        finishedAt: deployments.finishedAt,
      })
      .from(deployments)
      .where(eq(deployments.environmentId, environmentId))
      .orderBy(desc(deployments.startedAt), desc(deployments.createdAt))
      .limit(1),
    tx
      .select({ version: deployments.version, releaseId: deployments.releaseId })
      .from(deployments)
      .where(
        and(
          eq(deployments.environmentId, environmentId),
          eq(deployments.status, 'succeeded' as DeploymentStatus),
        ),
      )
      .orderBy(desc(deployments.startedAt), desc(deployments.createdAt))
      .limit(1),
  ]);
  await tx
    .update(environments)
    .set({
      currentVersion: current?.version ?? null,
      currentReleaseId: current?.releaseId ?? null,
      lastDeploymentId: last?.id ?? null,
      lastDeployedAt: last ? (last.finishedAt ?? last.startedAt) : null,
      lastStatus: last?.status ?? null,
    })
    .where(eq(environments.id, environmentId));
}
