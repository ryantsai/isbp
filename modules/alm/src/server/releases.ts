import { users } from '@isbp/db/schema';
import { NEW_CHANGE_PERMISSION } from '@isbp/module-itsm/contracts';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  calendarQuerySchema,
  createReleaseSchema,
  readinessSchema,
  releaseDetailSchema,
  releaseQuerySchema,
  releaseSummarySchema,
  updateReleaseSchema,
} from '../contracts';
import {
  canMoveRelease,
  evaluatePolicy,
  evaluateReadiness,
  OPEN_RELEASE_STATUSES,
  type PolicyChange,
  RELEASE_TRANSITIONS,
  type ReleaseStatus,
  releaseHref,
} from '../model';
import { personOf } from './access';
import { type ApplicationService, invalid, pgCode } from './applications';
import {
  type ChangeRow,
  findChange,
  linkedChanges,
  linkedChangesOf,
  toChangeInfo,
  toPolicyChange,
} from './changes';
import type { AppRow, ReleaseRow } from './refs';
import { applications, deployments, environments, releases } from './schema';

export const RELEASE_ENTITY = 'alm.release';
export type ReleaseSummaryOut = z.output<typeof releaseSummarySchema>;
export type ReleaseDetailOut = z.output<typeof releaseDetailSchema>;
export type ReadinessOut = z.output<typeof readinessSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const SORTABLE: Record<string, SQL> = {
  version: sql`${releases.version}`,
  plannedDate: sql`${releases.plannedDate}`,
  status: sql`${releases.status}`,
  createdAt: sql`${releases.createdAt}`,
  updatedAt: sql`${releases.updatedAt}`,
};

export const releaseLabel = (app: { code: string }, r: { version: string }) => `${app.code} ${r.version}`;

/** `YYYY-MM-DD` of today + `days` (UTC). */
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

export interface ReleaseFacts {
  testedIn: string[];
  failedInProduction: number;
}

/** Releases of an application and the cross-application calendar; readiness and its notification. */
export class ReleaseService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly apps: ApplicationService,
  ) {}

  /* ───────────── reading ───────────── */

  async resolve(id: string, db: Db = this.ctx.db): Promise<ReleaseRow> {
    if (!UUID_RE.test(id)) throw httpErrors.notFound('Release not found');
    const [row] = await db.select().from(releases).where(eq(releases.id, id));
    if (!row) throw httpErrors.notFound('Release not found');
    return row;
  }

  async byVersion(applicationId: string, version: string, db: Db = this.ctx.db): Promise<ReleaseRow | null> {
    const [row] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.applicationId, applicationId), eq(releases.version, version)));
    return row ?? null;
  }

  /** Test/staging successes and failed production deployments per release (one grouped query). */
  async facts(releaseIds: readonly string[], db: Db = this.ctx.db): Promise<Map<string, ReleaseFacts>> {
    const out = new Map<string, ReleaseFacts>();
    if (!releaseIds.length) return out;
    const rows = await db
      .select({
        releaseId: deployments.releaseId,
        testedIn: sql<
          string[]
        >`coalesce(array_agg(distinct ${environments.name}) filter (where ${deployments.status} = 'succeeded' and ${environments.kind} in ('test', 'staging')), '{}')`,
        failed:
          sql<number>`count(*) filter (where ${deployments.status} in ('failed', 'rolled_back') and ${environments.kind} = 'production')`.mapWith(
            Number,
          ),
      })
      .from(deployments)
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(inArray(deployments.releaseId, [...new Set(releaseIds)]))
      .groupBy(deployments.releaseId);
    for (const r of rows)
      if (r.releaseId)
        out.set(r.releaseId, { testedIn: [...(r.testedIn ?? [])].sort(), failedInProduction: r.failed });
    return out;
  }

  /** List rows with their linked changes and a readiness summary (batched for the whole page). */
  async summaries(rows: { release: ReleaseRow; app: Pick<AppRow, 'id' | 'code' | 'name'> }[]) {
    const now = new Date();
    const ids = rows.map((r) => r.release.id);
    const [changeMap, factMap] = await Promise.all([linkedChangesOf(this.ctx.db, ids, now), this.facts(ids)]);
    return rows.map(({ release, app }): ReleaseSummaryOut => {
      const changes = changeMap.get(release.id) ?? [];
      const facts = factMap.get(release.id) ?? { testedIn: [], failedInProduction: 0 };
      const readiness = evaluateReadiness(
        { changes: changes.map((c) => toPolicyChange(c)), notes: release.notes, ...facts },
        now,
      );
      return {
        id: release.id,
        application: { id: app.id, code: app.code, name: app.name },
        version: release.version,
        name: release.name,
        status: release.status,
        plannedDate: release.plannedDate,
        releasedAt: release.releasedAt,
        changes: changes.map((c) => toChangeInfo(c, now)),
        readiness: { passed: readiness.passed, total: readiness.total, ready: readiness.ready },
        createdAt: release.createdAt,
        updatedAt: release.updatedAt,
      };
    });
  }

  async list(appRef: string, q: z.output<typeof releaseQuerySchema>) {
    const app = await this.apps.resolve(appRef);
    const where = and(
      eq(releases.applicationId, app.id),
      q.status?.length ? inArray(releases.status, q.status) : undefined,
      q.q ? or(ilike(releases.version, likePattern(q.q)), ilike(releases.name, likePattern(q.q))) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'createdAt';
    const column = SORTABLE[key] ?? SORTABLE.createdAt!;
    const order = q.sort ? (q.sort.startsWith('-') ? desc(column) : asc(column)) : desc(column);
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select()
        .from(releases)
        .where(where)
        .orderBy(sql`${order} nulls last`, desc(releases.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(releases).where(where),
    ]);
    return {
      items: await this.summaries(rows.map((release) => ({ release, app }))),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** The cross-application release calendar: releases planned between `from` and `to`. */
  async calendar(q: z.output<typeof calendarQuerySchema>, auth: AuthContext) {
    const from = q.from ?? isoDay(0);
    const to = q.to ?? isoDay(56);
    const app = q.application ? await this.apps.resolve(q.application) : null;
    const rows = await this.ctx.db
      .select({
        release: releases,
        app: { id: applications.id, code: applications.code, name: applications.name },
      })
      .from(releases)
      .innerJoin(applications, eq(applications.id, releases.applicationId))
      .where(
        and(
          gte(releases.plannedDate, from),
          lte(releases.plannedDate, to),
          app ? eq(releases.applicationId, app.id) : undefined,
          q.status?.length ? inArray(releases.status, q.status) : undefined,
          q.mine ? await this.apps.ownedByCondition(auth) : undefined,
        ),
      )
      .orderBy(asc(releases.plannedDate), asc(applications.code), asc(releases.version))
      .limit(500);
    return { items: await this.summaries(rows) };
  }

  /** Open releases planned in the next `days` days (dashboard). */
  async upcoming(days: number, limit = 10) {
    const rows = await this.ctx.db
      .select({
        release: releases,
        app: { id: applications.id, code: applications.code, name: applications.name },
      })
      .from(releases)
      .innerJoin(applications, eq(applications.id, releases.applicationId))
      .where(
        and(
          gte(releases.plannedDate, isoDay(0)),
          lte(releases.plannedDate, isoDay(days)),
          inArray(releases.status, [...OPEN_RELEASE_STATUSES]),
        ),
      )
      .orderBy(asc(releases.plannedDate), asc(applications.code))
      .limit(limit);
    return this.summaries(rows);
  }

  /** A release by application code and version (the release page's URL). */
  async detailByVersion(appRef: string, version: string, auth: AuthContext): Promise<ReleaseDetailOut> {
    const app = await this.apps.resolve(appRef);
    const release = await this.byVersion(app.id, version);
    if (!release) throw httpErrors.notFound('Release not found');
    return this.detail(release.id, auth);
  }

  async detail(id: string, auth: AuthContext): Promise<ReleaseDetailOut> {
    const release = await this.resolve(id);
    const app = await this.apps.resolve(release.applicationId);
    const [[summary], creator, envs, lastPerEnv, [deployed], viewer] = await Promise.all([
      this.summaries([{ release, app }]),
      release.createdBy
        ? this.ctx.db
            .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
            .from(users)
            .where(eq(users.id, release.createdBy))
        : Promise.resolve([]),
      this.ctx.db
        .select()
        .from(environments)
        .where(eq(environments.applicationId, app.id))
        .orderBy(asc(environments.sort), asc(environments.createdAt)),
      this.ctx.db
        .selectDistinctOn([deployments.environmentId], {
          environmentId: deployments.environmentId,
          id: deployments.id,
          status: deployments.status,
          startedAt: deployments.startedAt,
          finishedAt: deployments.finishedAt,
        })
        .from(deployments)
        .where(eq(deployments.releaseId, release.id))
        .orderBy(deployments.environmentId, desc(deployments.startedAt)),
      this.ctx.db.select({ n: count() }).from(deployments).where(eq(deployments.releaseId, release.id)),
      this.apps.access.viewer(auth, app),
    ]);
    const last = new Map(lastPerEnv.map((d) => [d.environmentId, d]));
    return {
      ...summary!,
      application: {
        id: app.id,
        code: app.code,
        name: app.name,
        stage: app.stage,
        criticality: app.criticality,
      },
      notes: release.notes,
      createdBy: creator[0] ?? null,
      pipeline: envs.map((e) => {
        const d = last.get(e.id);
        return {
          environment: { id: e.id, name: e.name, kind: e.kind },
          deployment: d
            ? { id: d.id, status: d.status, startedAt: d.startedAt, finishedAt: d.finishedAt }
            : null,
          current:
            e.currentReleaseId === release.id ||
            (!e.currentReleaseId && e.currentVersion === release.version),
        };
      }),
      deploymentCount: deployed?.n ?? 0,
      transitions: viewer.canManageReleases ? [...RELEASE_TRANSITIONS[release.status]] : [],
      viewer,
    };
  }

  /* ───────────── readiness ───────────── */

  async readiness(id: string, auth: AuthContext, changeReference?: string): Promise<ReadinessOut> {
    const release = await this.resolve(id);
    const app = await this.apps.resolve(release.applicationId);
    const now = new Date();
    const [linked, facts, [prod], settings, named] = await Promise.all([
      linkedChanges(this.ctx, release.id, now),
      this.facts([release.id]),
      this.ctx.db
        .select({ id: environments.id })
        .from(environments)
        .where(and(eq(environments.applicationId, app.id), eq(environments.kind, 'production')))
        .limit(1),
      this.policySettings(),
      changeReference ? findChange(this.ctx.db, { reference: changeReference }) : Promise.resolve(null),
    ]);
    const f = facts.get(release.id) ?? { testedIn: [], failedInProduction: 0 };
    const titles = new Map<string, string>(
      [...linked, ...(named ? [named] : [])].map((c) => [c.id, c.title]),
    );
    const info = (c: PolicyChange | ChangeRow | null) => (c ? toChangeInfo(c, now, titles.get(c.id)) : null);
    const readiness = evaluateReadiness(
      { changes: linked.map((c) => toPolicyChange(c)), notes: release.notes, ...f },
      now,
    );
    const candidates = [
      ...(named ? [toPolicyChange(named, true)] : []),
      ...linked.filter((c) => c.id !== named?.id).map((c) => toPolicyChange(c)),
    ];
    const production = prod
      ? evaluatePolicy({ environmentKind: 'production', settings, changes: candidates, now })
      : null;
    return {
      ready: readiness.ready,
      passed: readiness.passed,
      total: readiness.total,
      checks: readiness.checks,
      change: info(readiness.change),
      changes: linked.map((c) => toChangeInfo(c, now)),
      testedIn: f.testedIn,
      failedInProduction: f.failedInProduction,
      policy: {
        requireChange: settings.requireChange,
        enforceWindow: settings.enforceWindow,
        production: production && { ...production, change: info(production.change) },
        named: info(named),
        namedNotFound: Boolean(changeReference && !named),
      },
      // Only for people ITSM gives the new-change form to (release managers can read changes, not raise them).
      raiseChangeHref: auth.can(NEW_CHANGE_PERMISSION) ? raiseChangeHref(app, release) : null,
    };
  }

  async policySettings() {
    const [requireChange, enforceWindow] = await Promise.all([
      this.ctx.settings.get<boolean>('policy.requireChange'),
      this.ctx.settings.get<boolean>('policy.enforceWindow'),
    ]);
    return { requireChange: requireChange !== false, enforceWindow: enforceWindow === true };
  }

  /**
   * Tells the application's owners once, when readiness first becomes all ✓ (`alm.release.ready`).
   * Idempotent: the `ready_notified_at` stamp is set with the notification in one transaction.
   */
  async checkReady(releaseId: string, tx?: Db) {
    const db = tx ?? this.ctx.db;
    const release = await this.resolve(releaseId, db);
    if (release.readyNotifiedAt || !OPEN_RELEASE_STATUSES.includes(release.status)) return false;
    const now = new Date();
    const [linked, facts] = await Promise.all([
      linkedChanges(this.ctx, release.id, now, tx),
      this.facts([release.id], db),
    ]);
    const readiness = evaluateReadiness(
      {
        changes: linked.map((c) => toPolicyChange(c)),
        notes: release.notes,
        ...(facts.get(release.id) ?? { testedIn: [], failedInProduction: 0 }),
      },
      now,
    );
    if (!readiness.ready) return false;
    const run = async (t: Db) => {
      const [stamped] = await t
        .update(releases)
        .set({ readyNotifiedAt: now })
        .where(and(eq(releases.id, release.id), isNull(releases.readyNotifiedAt)))
        .returning({ id: releases.id });
      if (!stamped) return false;
      const app = await this.apps.resolve(release.applicationId, t);
      await this.ctx.notifications.notify(
        {
          type: 'alm.release.ready',
          recipients: [app.businessOwnerId, app.technicalOwnerId],
          params: {
            application: app.name,
            code: app.code,
            version: release.version,
            change: readiness.change?.reference ?? '',
          },
          // Opens "Record deployment" for production straight away.
          href: `${releaseHref(app.code, release.version)}?deploy=production`,
        },
        { tx: t },
      );
      return true;
    };
    return tx ? run(tx) : this.ctx.transaction(run);
  }

  /* ───────────── writing ───────────── */

  async create(appRef: string, input: z.output<typeof createReleaseSchema>, auth: AuthContext) {
    const app = await this.apps.resolve(appRef);
    await this.apps.access.requireReleases(auth, app);
    try {
      const release = await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(releases)
          .values({
            applicationId: app.id,
            version: input.version,
            name: input.name || null,
            status: input.status,
            plannedDate: input.plannedDate ?? null,
            notes: input.notes || null,
            createdBy: personOf(auth),
          })
          .returning();
        const r = row!;
        // Deployments recorded before the release existed now belong to it.
        await tx
          .update(deployments)
          .set({ releaseId: r.id })
          .where(
            and(
              eq(deployments.applicationId, app.id),
              eq(deployments.version, r.version),
              isNull(deployments.releaseId),
            ),
          );
        await tx
          .update(environments)
          .set({ currentReleaseId: r.id })
          .where(and(eq(environments.applicationId, app.id), eq(environments.currentVersion, r.version)));
        await this.ctx.audit.record(
          {
            action: 'alm.release.created',
            entityType: RELEASE_ENTITY,
            entityId: r.id,
            entityLabel: releaseLabel(app, r),
            metadata: { applicationId: app.id, status: r.status, plannedDate: r.plannedDate },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'alm.release.created',
          { ...this.ref(app, r), status: r.status },
          { tx },
        );
        await this.checkReady(r.id, tx);
        return r;
      });
      return release;
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new HttpError(
          409,
          ErrorCodes.CONFLICT,
          'This application already has a release with this version',
          {
            issues: [{ path: 'version', message: 'Already in use' }],
          },
        );
      throw err;
    }
  }

  async update(id: string, input: z.output<typeof updateReleaseSchema>, auth: AuthContext) {
    const before = await this.resolve(id);
    const app = await this.apps.resolve(before.applicationId);
    await this.apps.access.requireReleases(auth, app);
    const patch: Partial<typeof releases.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name || null;
    if (input.plannedDate !== undefined) patch.plannedDate = input.plannedDate;
    if (input.notes !== undefined) patch.notes = input.notes || null;
    if (input.version !== undefined && input.version !== before.version) {
      const [used] = await this.ctx.db
        .select({ n: count() })
        .from(deployments)
        .where(
          or(
            eq(deployments.releaseId, before.id),
            and(eq(deployments.applicationId, app.id), eq(deployments.version, input.version)),
          ),
        );
      if (used!.n > 0) throw invalid('version', 'The version cannot change once it has been deployed');
      patch.version = input.version;
    }
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx.update(releases).set(patch).where(eq(releases.id, before.id)).returning();
        const r = row!;
        await this.ctx.audit.record(
          {
            action: 'alm.release.updated',
            entityType: RELEASE_ENTITY,
            entityId: r.id,
            entityLabel: releaseLabel(app, r),
            // Release notes can be long: record that they changed, not both versions.
            changes: 'notes' in changes ? { ...changes, notes: ['…', '…'] } : changes,
          },
          { tx },
        );
        await this.ctx.events.publish(
          'alm.release.updated',
          { ...this.ref(app, r), changes: Object.keys(changes) },
          { tx },
        );
        if ('notes' in changes) await this.checkReady(r.id, tx);
        return r;
      });
    } catch (err) {
      if (pgCode(err) === '23505')
        throw invalid('version', 'This application already has a release with this version');
      throw err;
    }
  }

  async setStatus(id: string, to: ReleaseStatus, auth: AuthContext) {
    const before = await this.resolve(id);
    const app = await this.apps.resolve(before.applicationId);
    await this.apps.access.requireReleases(auth, app);
    if (before.status === to) return before;
    if (!canMoveRelease(before.status, to))
      throw new HttpError(
        409,
        ErrorCodes.INVALID_TRANSITION,
        `A ${before.status} release cannot become ${to}`,
        {
          from: before.status,
          allowed: RELEASE_TRANSITIONS[before.status],
        },
      );
    return this.ctx.transaction((tx) => this.move(tx, app, before, to, new Date()));
  }

  /** Changes the status (manual, a successful production deployment, or a linked change). */
  async move(
    tx: Db,
    app: AppRow,
    before: ReleaseRow,
    to: ReleaseStatus,
    at: Date,
    metadata?: Record<string, unknown>,
  ) {
    const [row] = await tx
      .update(releases)
      .set({ status: to, ...(to === 'released' ? { releasedAt: at } : {}) })
      .where(and(eq(releases.id, before.id), eq(releases.status, before.status)))
      .returning();
    if (!row) return before;
    await this.ctx.audit.record(
      {
        action: 'alm.release.status_changed',
        entityType: RELEASE_ENTITY,
        entityId: row.id,
        entityLabel: releaseLabel(app, row),
        changes: { status: [before.status, to] },
        metadata,
      },
      { tx },
    );
    await this.ctx.events.publish(
      'alm.release.status_changed',
      { ...this.ref(app, row), from: before.status, to },
      { tx },
    );
    return row;
  }

  /** A change was linked to the release: a planned release is now in progress; readiness re-checked. */
  async onChangeLinked(releaseId: string, changeId: string) {
    const release = await this.ctx.db.select().from(releases).where(eq(releases.id, releaseId));
    if (!release[0]) return;
    const app = await this.apps.resolve(release[0].applicationId);
    await this.ctx.transaction(async (tx) => {
      if (release[0]!.status === 'planned')
        await this.move(tx, app, release[0]!, 'in_progress', new Date(), {
          reason: 'change_linked',
          changeId,
        });
      await this.checkReady(releaseId, tx);
    });
  }

  ref(app: Pick<AppRow, 'id' | 'code' | 'name'>, r: Pick<ReleaseRow, 'id' | 'version'>) {
    return { applicationId: app.id, code: app.code, name: app.name, releaseId: r.id, version: r.version };
  }
}

export function raiseChangeHref(app: Pick<AppRow, 'name'>, release: Pick<ReleaseRow, 'id' | 'version'>) {
  const title = `Deploy ${app.name} ${release.version} to production`;
  return `/itsm/changes?new=1&title=${encodeURIComponent(title)}&link=alm.release:${release.id}`;
}
