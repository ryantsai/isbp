import { departments, groups, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  appDetailSchema,
  appQuerySchema,
  createAppSchema,
  createEnvironmentSchema,
  createRepositorySchema,
  gitStatusSchema,
  updateAppSchema,
  updateEnvironmentSchema,
  updateRepositorySchema,
} from '../contracts';
import { appHref, OPEN_RELEASE_STATUSES } from '../model';
import { AppAccess, groupsOf, personOf } from './access';
import {
  type AppRow,
  appExtras,
  ciInfos,
  type EnvironmentOut,
  type EnvRow,
  type RepositoryOut,
  selectApps,
  supportAndDepartment,
  toAppSummary,
  toEnvironment,
  toRepository,
} from './refs';
import { applications, deployments, environments, releases, repositories } from './schema';
import { viaOf } from './sync-support';

/** Branches and active pull requests: only a sync with the Git server writes them (not the REST API). */
type GitStatus = z.output<typeof gitStatusSchema>;

export const APP_ENTITY = 'alm.application';
type CreateInput = z.output<typeof createAppSchema>;
type UpdateInput = z.output<typeof updateAppSchema>;
type ListQuery = z.output<typeof appQuerySchema>;
export type AppDetailOut = z.output<typeof appDetailSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAGE_RANK = sql`case ${applications.stage} when 'planned' then 0 when 'development' then 1 when 'production' then 2 when 'sunsetting' then 3 else 4 end`;
const CRITICALITY_RANK = sql`case ${applications.criticality} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;
const SORTABLE: Record<string, SQL> = {
  code: sql`${applications.code}`,
  name: sql`${applications.name}`,
  stage: STAGE_RANK,
  criticality: CRITICALITY_RANK,
  hosting: sql`${applications.hosting}`,
  updatedAt: sql`${applications.updatedAt}`,
};

export function invalid(path: string, message: string): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });
}

export function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** `Finance ERP (erp)` — the label audit rows show. */
export const auditLabel = (a: { code: string; name: string }) => `${a.name} (${a.code})`;
const appRef = (a: AppRow) => ({ applicationId: a.id, code: a.code, name: a.name });

/** Code or name (trigram-indexed `ILIKE`). */
export function appSearchCondition(term: string): SQL {
  const pattern = likePattern(term.trim());
  return or(ilike(applications.code, pattern), ilike(applications.name, pattern))!;
}

/**
 * The application inventory: applications, their environments and repositories. Shared by routes, AI
 * tools, record resolvers and a future sync adapter — every write takes the caller's `auth` and checks
 * the ownership rule itself.
 */
export class ApplicationService {
  readonly access: AppAccess;

  constructor(private readonly ctx: ModuleContext) {
    this.access = new AppAccess(ctx.db);
  }

  /* ───────────── reading ───────────── */

  /** An application by code (`erp`) or id; 404 otherwise. */
  async resolve(ref: string, db: Db = this.ctx.db): Promise<AppRow> {
    const value = ref.trim();
    const [row] = await db
      .select()
      .from(applications)
      .where(UUID_RE.test(value) ? eq(applications.id, value) : eq(applications.code, value.toLowerCase()));
    if (!row) throw httpErrors.notFound('Application not found');
    return row;
  }

  /** Filters shared by the list, the calendar ("mine") and the AI tools. */
  async ownedByCondition(auth: AuthContext): Promise<SQL | undefined> {
    const me = personOf(auth);
    if (!me) return sql`false`;
    const mine = [...(await groupsOf(this.ctx.db, auth))];
    return or(
      eq(applications.businessOwnerId, me),
      eq(applications.technicalOwnerId, me),
      mine.length ? inArray(applications.teamGroupId, mine) : undefined,
    );
  }

  async list(q: ListQuery, auth: AuthContext) {
    const owner =
      q.owner === 'me'
        ? await this.ownedByCondition(auth)
        : q.owner
          ? or(eq(applications.businessOwnerId, q.owner), eq(applications.technicalOwnerId, q.owner))
          : undefined;
    const where = and(
      q.stage?.length ? inArray(applications.stage, q.stage) : undefined,
      q.criticality?.length ? inArray(applications.criticality, q.criticality) : undefined,
      q.hosting?.length ? inArray(applications.hosting, q.hosting) : undefined,
      q.disposition?.length ? inArray(applications.disposition, q.disposition) : undefined,
      q.team ? eq(applications.teamGroupId, q.team) : undefined,
      owner,
      q.q ? appSearchCondition(q.q) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'name';
    const column = SORTABLE[key] ?? SORTABLE.name!;
    const order = q.sort?.startsWith('-') ? desc(column) : asc(column);
    const [rows, [total]] = await Promise.all([
      selectApps(this.ctx.db)
        .where(where)
        .orderBy(order, asc(applications.code))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(applications).where(where),
    ]);
    const extras = await appExtras(
      this.ctx.db,
      rows.map((r) => r.app.id),
    );
    return {
      items: rows.map((r) => toAppSummary(r, extras)),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(ref: string, auth: AuthContext): Promise<AppDetailOut> {
    const app = await this.resolve(ref);
    const [[row], extras, envs, repos, counts, viewer] = await Promise.all([
      selectApps(this.ctx.db).where(eq(applications.id, app.id)),
      appExtras(this.ctx.db, [app.id]),
      this.environments(app.id),
      this.ctx.db
        .select()
        .from(repositories)
        .where(eq(repositories.applicationId, app.id))
        .orderBy(asc(repositories.name)),
      this.counts(app.id),
      this.access.viewer(auth, app),
    ]);
    if (!row) throw httpErrors.notFound('Application not found');
    const ci = app.ciId ? ((await ciInfos(this.ctx.db, [app.ciId])).get(app.ciId) ?? null) : null;
    return {
      ...toAppSummary(row, extras),
      ...supportAndDepartment(row),
      description: app.description,
      vendor: app.vendor,
      ci,
      techStack: app.techStack,
      documentationUrl: app.documentationUrl,
      dataClassification: app.dataClassification,
      goLiveDate: app.goLiveDate,
      retireDate: app.retireDate,
      attributes: app.attributes,
      environments: envs,
      repositories: repos.map(toRepository),
      counts,
      viewer,
      createdAt: app.createdAt,
    };
  }

  private async counts(applicationId: string) {
    const open = sql.join(
      OPEN_RELEASE_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );
    const result = await this.ctx.db.execute<{
      releases: number;
      open_releases: number;
      deployments: number;
    }>(sql`
      select
        (select count(*) from alm.releases where application_id = ${applicationId})::int as releases,
        (select count(*) from alm.releases where application_id = ${applicationId} and status in (${open}))::int as open_releases,
        (select count(*) from alm.deployments where application_id = ${applicationId})::int as deployments`);
    const r = result.rows[0];
    return {
      releases: Number(r?.releases ?? 0),
      openReleases: Number(r?.open_releases ?? 0),
      deployments: Number(r?.deployments ?? 0),
    };
  }

  /* ───────────── writing: applications ───────────── */

  /** People must exist and not be offboarded; groups, department and CI must exist. */
  private async assertReferences(input: Partial<CreateInput>) {
    const checks: Promise<void>[] = [];
    const person = (path: 'businessOwnerId' | 'technicalOwnerId') => {
      const value = input[path];
      if (!value) return;
      checks.push(
        this.ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, value), ne(users.status, 'offboarded')))
          .then(([r]) => {
            if (!r) throw invalid(path, 'Unknown or offboarded person');
          }),
      );
    };
    const group = (path: 'teamGroupId' | 'supportGroupId') => {
      const value = input[path];
      if (!value) return;
      checks.push(
        this.ctx.db
          .select({ id: groups.id })
          .from(groups)
          .where(eq(groups.id, value))
          .then(([r]) => {
            if (!r) throw invalid(path, 'Unknown group');
          }),
      );
    };
    person('businessOwnerId');
    person('technicalOwnerId');
    group('teamGroupId');
    group('supportGroupId');
    if (input.departmentId)
      checks.push(
        this.ctx.db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, input.departmentId))
          .then(([r]) => {
            if (!r) throw invalid('departmentId', 'Unknown department');
          }),
      );
    if (input.ciId) checks.push(this.assertCi('ciId', input.ciId));
    if (input.goLiveDate && input.retireDate && input.retireDate < input.goLiveDate)
      throw invalid('retireDate', 'The retirement date is before the go-live date');
    await Promise.all(checks);
  }

  private async assertCi(path: string, ciId: string) {
    const [r] = await this.ctx.db.select({ id: cis.id }).from(cis).where(eq(cis.id, ciId));
    if (!r) throw invalid(path, 'Unknown configuration item');
  }

  async create(input: CreateInput, auth: AuthContext): Promise<AppRow> {
    auth.require('alm.apps.manage');
    await this.assertReferences(input);
    const attributes = await this.ctx.fields.validate(APP_ENTITY, input.attributes ?? {});
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(applications)
          .values({
            code: input.code,
            name: input.name,
            description: input.description || null,
            stage: input.stage,
            criticality: input.criticality,
            disposition: input.disposition ?? null,
            businessOwnerId: input.businessOwnerId ?? null,
            technicalOwnerId: input.technicalOwnerId ?? null,
            teamGroupId: input.teamGroupId ?? null,
            supportGroupId: input.supportGroupId ?? null,
            departmentId: input.departmentId ?? null,
            vendor: input.vendor || null,
            hosting: input.hosting,
            ciId: input.ciId ?? null,
            techStack: [...new Set(input.techStack)],
            documentationUrl: input.documentationUrl ?? null,
            dataClassification: input.dataClassification,
            goLiveDate: input.goLiveDate ?? null,
            retireDate: input.retireDate ?? null,
            attributes,
            createdBy: personOf(auth),
          })
          .returning();
        const app = row!;
        await this.ctx.audit.record(
          {
            action: 'alm.application.created',
            entityType: APP_ENTITY,
            entityId: app.id,
            entityLabel: auditLabel(app),
            metadata: { stage: app.stage, criticality: app.criticality },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'alm.application.created',
          { ...appRef(app), stage: app.stage },
          { tx },
        );
        return app;
      });
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new HttpError(409, ErrorCodes.CONFLICT, 'An application with this code already exists', {
          issues: [{ path: 'code', message: 'Already in use' }],
        });
      throw err;
    }
  }

  async update(ref: string, input: UpdateInput, auth: AuthContext): Promise<AppRow> {
    const before = await this.resolve(ref);
    await this.access.requireEdit(auth, before);
    const changed = Object.fromEntries(
      Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'attributes'),
    ) as Partial<CreateInput>;
    await this.assertReferences({
      ...changed,
      goLiveDate: input.goLiveDate === undefined ? before.goLiveDate : input.goLiveDate,
      retireDate: input.retireDate === undefined ? before.retireDate : input.retireDate,
    });
    const patch: Partial<typeof applications.$inferInsert> = { ...(changed as object) };
    if (input.description !== undefined) patch.description = input.description || null;
    if (input.vendor !== undefined) patch.vendor = input.vendor || null;
    if (input.techStack) patch.techStack = [...new Set(input.techStack)];
    if (input.attributes)
      patch.attributes = await this.ctx.fields.validate(APP_ENTITY, input.attributes, before.attributes);
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(applications)
        .set(patch)
        .where(eq(applications.id, before.id))
        .returning();
      const app = row!;
      await this.ctx.audit.record(
        {
          action: 'alm.application.updated',
          entityType: APP_ENTITY,
          entityId: app.id,
          entityLabel: auditLabel(app),
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'alm.application.updated',
        { ...appRef(app), changes: Object.keys(changes) },
        { tx },
      );
      if ('stage' in changes)
        await this.ctx.events.publish(
          'alm.application.stage_changed',
          { ...appRef(app), from: before.stage, to: app.stage },
          { tx },
        );
      return app;
    });
  }

  /** Clears a person's application ownership when they leave (idempotent, audited). */
  async releaseOwner(userId: string) {
    return this.ctx.transaction(async (tx) => {
      const owned = await tx
        .select()
        .from(applications)
        .where(or(eq(applications.businessOwnerId, userId), eq(applications.technicalOwnerId, userId)));
      for (const app of owned) {
        const patch = {
          ...(app.businessOwnerId === userId ? { businessOwnerId: null } : {}),
          ...(app.technicalOwnerId === userId ? { technicalOwnerId: null } : {}),
        };
        await tx.update(applications).set(patch).where(eq(applications.id, app.id));
        const changes = Object.fromEntries(
          Object.keys(patch).map((k) => [k, [userId, null] as [unknown, unknown]]),
        );
        await this.ctx.audit.record(
          {
            action: 'alm.application.owner_released',
            entityType: APP_ENTITY,
            entityId: app.id,
            entityLabel: auditLabel(app),
            changes,
            metadata: { reason: 'offboarded' },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'alm.application.updated',
          { ...appRef(app), changes: Object.keys(patch) },
          { tx },
        );
      }
      return owned.length;
    });
  }

  /** Audit + `alm.application.updated` for a change to an application's environments or repositories. */
  private async touched(
    tx: Db,
    app: AppRow,
    part: 'environments' | 'repositories',
    action: string,
    entityLabel: string,
    extra: { changes?: Record<string, [unknown, unknown]>; metadata?: Record<string, unknown> } = {},
  ) {
    await tx.update(applications).set({ updatedAt: new Date() }).where(eq(applications.id, app.id));
    await this.ctx.audit.record(
      {
        action,
        entityType: APP_ENTITY,
        entityId: app.id,
        entityLabel: `${auditLabel(app)} · ${entityLabel}`,
        ...extra,
      },
      { tx },
    );
    await this.ctx.events.publish('alm.application.updated', { ...appRef(app), changes: [part] }, { tx });
  }

  /* ───────────── environments ───────────── */

  async environments(applicationId: string): Promise<EnvironmentOut[]> {
    const rows = await this.ctx.db
      .select()
      .from(environments)
      .where(eq(environments.applicationId, applicationId))
      .orderBy(asc(environments.sort), asc(environments.createdAt));
    return this.environmentDtos(rows);
  }

  async environmentDtos(rows: EnvRow[]): Promise<EnvironmentOut[]> {
    if (!rows.length) return [];
    const envIds = rows.map((e) => e.id);
    const releaseIds = rows.map((e) => e.currentReleaseId).filter((x): x is string => Boolean(x));
    const lastIds = rows.map((e) => e.lastDeploymentId).filter((x): x is string => Boolean(x));
    const [ciMap, counts, rels, lasts] = await Promise.all([
      ciInfos(
        this.ctx.db,
        rows.map((e) => e.ciId),
      ),
      this.ctx.db
        .select({ id: deployments.environmentId, n: count() })
        .from(deployments)
        .where(inArray(deployments.environmentId, envIds))
        .groupBy(deployments.environmentId),
      releaseIds.length
        ? this.ctx.db
            .select({ id: releases.id, version: releases.version })
            .from(releases)
            .where(inArray(releases.id, releaseIds))
        : Promise.resolve([]),
      lastIds.length
        ? this.ctx.db
            .select({ id: deployments.id, version: deployments.version })
            .from(deployments)
            .where(inArray(deployments.id, lastIds))
        : Promise.resolve([]),
    ]);
    const countOf = new Map(counts.map((c) => [c.id, c.n]));
    const relOf = new Map(rels.map((r) => [r.id, r]));
    const lastOf = new Map(lasts.map((d) => [d.id, d.version]));
    return rows.map((e) =>
      toEnvironment(
        e,
        e.ciId ? (ciMap.get(e.ciId) ?? null) : null,
        e.currentReleaseId ? (relOf.get(e.currentReleaseId) ?? null) : null,
        countOf.get(e.id) ?? 0,
        e.lastDeploymentId ? (lastOf.get(e.lastDeploymentId) ?? null) : null,
      ),
    );
  }

  private async environment(app: AppRow, id: string, db: Db = this.ctx.db): Promise<EnvRow> {
    const [row] = await db
      .select()
      .from(environments)
      .where(and(eq(environments.id, id), eq(environments.applicationId, app.id)));
    if (!row) throw httpErrors.notFound('Environment not found');
    return row;
  }

  private duplicateName(err: unknown, what: string): never {
    if (pgCode(err) === '23505')
      throw new HttpError(409, ErrorCodes.CONFLICT, `This application already has ${what}`, {
        issues: [{ path: what === 'this repository' ? 'url' : 'name', message: 'Already in use' }],
      });
    throw err;
  }

  async createEnvironment(ref: string, input: z.output<typeof createEnvironmentSchema>, auth: AuthContext) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    if (input.ciId) await this.assertCi('ciId', input.ciId);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [{ next } = { next: 0 }] = await tx
          .select({ next: sql<number>`coalesce(max(${environments.sort}) + 1, 0)`.mapWith(Number) })
          .from(environments)
          .where(eq(environments.applicationId, app.id));
        const [row] = await tx
          .insert(environments)
          .values({
            applicationId: app.id,
            name: input.name,
            kind: input.kind,
            url: input.url ?? null,
            ciId: input.ciId ?? null,
            sort: input.sort ?? next,
          })
          .returning();
        await this.touched(tx, app, 'environments', 'alm.environment.created', row!.name, {
          metadata: { environmentId: row!.id, kind: row!.kind },
        });
        return row!;
      });
    } catch (err) {
      return this.duplicateName(err, 'an environment with this name');
    }
  }

  async updateEnvironment(
    ref: string,
    id: string,
    input: z.output<typeof updateEnvironmentSchema>,
    auth: AuthContext,
  ) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    const before = await this.environment(app, id);
    if (input.ciId) await this.assertCi('ciId', input.ciId);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const changes = this.ctx.audit.diff(before as unknown as Record<string, unknown>, patch);
    if (!Object.keys(changes).length) return before;
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(environments)
          .set(patch)
          .where(eq(environments.id, before.id))
          .returning();
        await this.touched(tx, app, 'environments', 'alm.environment.updated', row!.name, {
          changes,
          metadata: { environmentId: row!.id },
        });
        return row!;
      });
    } catch (err) {
      return this.duplicateName(err, 'an environment with this name');
    }
  }

  /** Only environments without deployments can go (the history must stay explainable). */
  async deleteEnvironment(ref: string, id: string, auth: AuthContext) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    const env = await this.environment(app, id);
    const [used] = await this.ctx.db
      .select({ n: count() })
      .from(deployments)
      .where(eq(deployments.environmentId, env.id));
    if (used!.n > 0)
      throw new HttpError(409, ErrorCodes.IN_USE, 'This environment has deployments and cannot be deleted', {
        deployments: used!.n,
      });
    await this.ctx.transaction(async (tx) => {
      await tx.delete(environments).where(eq(environments.id, env.id));
      await this.touched(tx, app, 'environments', 'alm.environment.deleted', env.name, {
        metadata: { environmentId: env.id, kind: env.kind },
      });
    });
  }

  /** Puts the environments in the given order (the pipeline left to right). */
  async reorderEnvironments(ref: string, ids: string[], auth: AuthContext) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    const rows = await this.ctx.db
      .select({ id: environments.id, sort: environments.sort, name: environments.name })
      .from(environments)
      .where(eq(environments.applicationId, app.id));
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i)))
      throw invalid('ids', 'Give every environment of the application exactly once');
    await this.ctx.transaction(async (tx) => {
      for (const [sort, id] of ids.entries())
        await tx.update(environments).set({ sort }).where(eq(environments.id, id));
      await this.touched(tx, app, 'environments', 'alm.environment.reordered', 'order', {
        metadata: { order: ids.map((i) => rows.find((r) => r.id === i)!.name) },
      });
    });
    return this.environments(app.id);
  }

  /* ───────────── repositories ───────────── */

  async repositories(ref: string): Promise<RepositoryOut[]> {
    const app = await this.resolve(ref);
    const rows = await this.ctx.db
      .select()
      .from(repositories)
      .where(eq(repositories.applicationId, app.id))
      .orderBy(asc(repositories.name));
    return rows.map(toRepository);
  }

  private async repository(app: AppRow, id: string) {
    const [row] = await this.ctx.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.id, id), eq(repositories.applicationId, app.id)));
    if (!row) throw httpErrors.notFound('Repository not found');
    return row;
  }

  /** `alm.repository.created` / `updated`, with the repository's id (sync adapters follow these). */
  private repoRef(app: AppRow, repo: { id: string; name: string }) {
    return { ...appRef(app), repositoryId: repo.id, repository: repo.name };
  }

  async createRepository(
    ref: string,
    input: z.output<typeof createRepositorySchema> & GitStatus,
    auth: AuthContext,
  ) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    const synced = viaOf(this.ctx) ? new Date() : null;
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(repositories)
          .values({
            applicationId: app.id,
            name: input.name,
            url: input.url,
            provider: input.provider,
            defaultBranch: input.defaultBranch,
            lastCommitSha: input.lastCommitSha ?? null,
            lastCommitAt: input.lastCommitAt ?? null,
            lastCommitMessage: input.lastCommitMessage ?? null,
            lastCommitAuthor: input.lastCommitAuthor ?? null,
            branches: input.branches ?? null,
            pullRequests: input.pullRequests ?? null,
            syncedAt: synced,
          })
          .returning();
        await this.touched(tx, app, 'repositories', 'alm.repository.created', row!.name, {
          metadata: { repositoryId: row!.id, url: row!.url },
        });
        await this.ctx.events.publish('alm.repository.created', this.repoRef(app, row!), { tx });
        return toRepository(row!);
      });
    } catch (err) {
      return this.duplicateName(err, 'this repository');
    }
  }

  async updateRepository(
    ref: string,
    id: string,
    input: z.output<typeof updateRepositorySchema> & GitStatus,
    auth: AuthContext,
  ) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    const before = await this.repository(app, id);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const changes = this.ctx.audit.diff(before as unknown as Record<string, unknown>, patch);
    // Lists of branches and pull requests are summarised in the audit row, not copied.
    for (const k of ['branches', 'pullRequests'] as const)
      if (changes[k]) changes[k] = [before[k]?.length ?? null, input[k]?.length ?? null];
    // A sync that finds nothing new still says when it last looked (without counting as an edit).
    const synced = viaOf(this.ctx) ? { syncedAt: new Date() } : {};
    if (!Object.keys(changes).length) {
      if (!synced.syncedAt) return toRepository(before);
      const [row] = await this.ctx.db
        .update(repositories)
        .set({ ...synced, updatedAt: sql`${repositories.updatedAt}` })
        .where(eq(repositories.id, before.id))
        .returning();
      return toRepository(row!);
    }
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(repositories)
          .set({ ...patch, ...synced })
          .where(eq(repositories.id, before.id))
          .returning();
        await this.touched(tx, app, 'repositories', 'alm.repository.updated', row!.name, {
          changes,
          metadata: { repositoryId: row!.id },
        });
        await this.ctx.events.publish(
          'alm.repository.updated',
          { ...this.repoRef(app, row!), changes: Object.keys(changes) },
          { tx },
        );
        return toRepository(row!);
      });
    } catch (err) {
      return this.duplicateName(err, 'this repository');
    }
  }

  async deleteRepository(ref: string, id: string, auth: AuthContext) {
    const app = await this.resolve(ref);
    await this.access.requireEdit(auth, app);
    const repo = await this.repository(app, id);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(repositories).where(eq(repositories.id, repo.id));
      await this.touched(tx, app, 'repositories', 'alm.repository.deleted', repo.name, {
        metadata: { repositoryId: repo.id, url: repo.url },
      });
    });
  }

  /* ───────────── CMDB slot ───────────── */

  /** Applications whose CI, or one of whose environments' CI, is `ciId` (the CMDB CI page). */
  async forCi(ciId: string) {
    const envRows = await this.ctx.db
      .select({ applicationId: environments.applicationId, name: environments.name })
      .from(environments)
      .where(eq(environments.ciId, ciId))
      .orderBy(asc(environments.sort));
    const ids = [...new Set(envRows.map((e) => e.applicationId))];
    const rows = await selectApps(this.ctx.db)
      .where(or(eq(applications.ciId, ciId), ids.length ? inArray(applications.id, ids) : undefined))
      .orderBy(asc(applications.name))
      .limit(20);
    const extras = await appExtras(
      this.ctx.db,
      rows.map((r) => r.app.id),
    );
    return rows.map((r) => {
      const envs = envRows.filter((e) => e.applicationId === r.app.id).map((e) => e.name);
      const roles: ('application' | 'environment')[] = [];
      if (r.app.ciId === ciId) roles.push('application');
      if (envs.length) roles.push('environment');
      return { ...toAppSummary(r, extras), roles, environments: envs };
    });
  }

  href = (app: { code: string }) => appHref(app.code);
}
