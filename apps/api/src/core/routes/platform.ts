import {
  auditLogSchema,
  auditQuerySchema,
  auditVerifySchema,
  createIdpSchema,
  dashboardSchema,
  idpSchema,
  idpTestResultSchema,
  moduleInfoSchema,
  navigationSchema,
  okSchema,
  searchResponseSchema,
  toggleModuleSchema,
  updateIdpSchema,
  updateModuleSettingsSchema,
} from '@isbp/contracts';
import { auditLogs, departments, groups, roleAssignments, roles, sessions, users } from '@isbp/db/schema';
import {
  HttpError,
  httpErrors,
  type ModuleContext,
  type ModuleRouter,
  type NavEntry,
  pageSchema,
  type ServerModule,
} from '@isbp/sdk/server';
import { and, count, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditHash } from '../../kernel/audit';
import { getKernel } from '../kernel-ref';
import { auditWhere, refsFor, resolveRefs } from '../services/audit';
import type { IdpService } from '../services/idp';
import { pageOffset } from '../util';

const idParams = z.object({ id: z.uuid() });

/** An origin a public page may be framed by: `https://host[:port]` (`http://` for localhost only). */
const FRAME_ORIGIN = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d{1,5})?$/;

function auditDto(r: typeof auditLogs.$inferSelect) {
  return {
    seq: r.seq,
    eventId: r.eventId,
    occurredAt: r.occurredAt,
    actorType: r.actorType,
    actorId: r.actorId,
    actorName: r.actorName,
    action: r.action,
    category: r.category,
    moduleId: r.moduleId,
    entityType: r.entityType,
    entityId: r.entityId,
    entityLabel: r.entityLabel,
    changes: r.changes,
    metadata: r.metadata,
    outcome: r.outcome,
    ip: r.ip,
    userAgent: r.userAgent,
    requestId: r.requestId,
  };
}

export function platformRoutes(app: ModuleRouter, ctx: ModuleContext, idps: IdpService) {
  const kernel = getKernel();

  /* ───────────── audit ───────────── */

  app.get(
    '/audit-logs',
    {
      config: { permission: 'core.audit.read' },
      schema: {
        tags: ['Audit'],
        summary: 'Search the immutable audit trail',
        querystring: auditQuerySchema,
        response: { 200: pageSchema(auditLogSchema) },
      },
    },
    async (req) => {
      const q = req.query;
      const where = await auditWhere(ctx.db, q, req.userRow?.locale);
      const [rows, [total]] = await Promise.all([
        ctx.db
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(q.sort === 'occurredAt' ? auditLogs.seq : desc(auditLogs.seq))
          .limit(q.pageSize)
          .offset(pageOffset(q.page, q.pageSize)),
        ctx.db.select({ n: count() }).from(auditLogs).where(where),
      ]);
      const refs = await resolveRefs(ctx.db, rows);
      return {
        items: rows.map((r) => ({ ...auditDto(r), refs: refsFor(r, refs) })),
        total: total!.n,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.get(
    '/audit-logs/:seq',
    {
      config: { permission: 'core.audit.read' },
      schema: {
        tags: ['Audit'],
        summary: 'One audit record',
        params: z.object({ seq: z.coerce.number().int() }),
        response: { 200: auditLogSchema },
      },
    },
    async (req) => {
      const [row] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.seq, req.params.seq));
      if (!row) throw httpErrors.notFound('Audit record not found');
      return { ...auditDto(row), refs: refsFor(row, await resolveRefs(ctx.db, [row])) };
    },
  );

  app.get(
    '/audit-logs/:seq/verify',
    {
      config: { permission: 'core.audit.read' },
      schema: {
        tags: ['Audit'],
        summary: 'Recompute and verify a record’s integrity hash',
        params: z.object({ seq: z.coerce.number().int() }),
        response: { 200: auditVerifySchema },
      },
    },
    async (req) => {
      const [row] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.seq, req.params.seq));
      if (!row) throw httpErrors.notFound('Audit record not found');
      const { hash, seq, traceId: _t, ...rest } = row;
      return { seq, valid: auditHash(rest) === hash, hash };
    },
  );

  /* ───────────── modules ───────────── */

  async function moduleInfo(m: ServerModule) {
    const state = kernel.registry.stateOf(m.manifest.id);
    const values = await kernel.settings.publicValues(m.manifest);
    const countNav = (entries: NavEntry[] = []): number =>
      entries.reduce((n, e) => n + 1 + countNav(e.children) + countNav(e.tabs), 0);
    return {
      id: m.manifest.id,
      name: m.manifest.name,
      description: m.manifest.description ?? null,
      version: m.manifest.version,
      icon: m.manifest.icon ?? null,
      enabled: kernel.registry.isEnabled(m.manifest.id),
      system: m.manifest.system ?? false,
      dependsOn: m.manifest.dependsOn ?? [],
      dependents: kernel.registry.dependentsOf(m.manifest.id),
      permissions: (m.manifest.permissions ?? []).map((p) => ({ key: p.key, description: p.description })),
      events: {
        emits: (m.manifest.events?.emits ?? []).map((e) => ({
          name: e.name,
          description: e.description ?? null,
        })),
        consumes: m.manifest.events?.consumes ?? [],
      },
      aiTools: (m.manifest.ai?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        permission: t.permission,
        destructive: t.destructive ?? false,
      })),
      aiAgent: m.manifest.ai?.agent
        ? { name: m.manifest.ai.agent.name, permissions: [...m.manifest.ai.agent.permissions] }
        : null,
      settings: (m.manifest.settings ?? []).map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description ?? null,
        type: s.type,
        advanced: s.advanced ?? false,
        options: s.options ?? null,
        value: values[s.key] ?? null,
      })),
      navigation: countNav(m.manifest.navigation),
      jobs: Object.entries(m.jobs ?? {}).map(([name, j]) => ({
        name,
        description: j.description ?? null,
        schedule:
          j.schedule?.cron ??
          (j.schedule?.everyMs ? `every ${Math.round(j.schedule.everyMs / 1000)}s` : null),
      })),
      enabledChangedAt: state?.enabledChangedAt ?? null,
      installedAt: state?.installedAt ?? new Date(),
    };
  }

  app.get(
    '/modules',
    {
      config: { permission: 'core.modules.read' },
      schema: {
        tags: ['Modules'],
        summary: 'Installed modules',
        response: { 200: z.object({ items: z.array(moduleInfoSchema) }) },
      },
    },
    async () => ({ items: await Promise.all(kernel.registry.modules.map(moduleInfo)) }),
  );

  app.get(
    '/modules/:moduleId',
    {
      config: { permission: 'core.modules.read' },
      schema: {
        tags: ['Modules'],
        summary: 'Module details',
        params: z.object({ moduleId: z.string().max(64) }),
        response: { 200: moduleInfoSchema },
      },
    },
    async (req) => {
      const m = kernel.registry.get(req.params.moduleId);
      if (!m) throw httpErrors.notFound('Module not installed');
      return moduleInfo(m);
    },
  );

  app.post(
    '/modules/:moduleId/toggle',
    {
      config: { permission: 'core.modules.manage' },
      schema: {
        tags: ['Modules'],
        summary: 'Enable or disable a module at runtime',
        params: z.object({ moduleId: z.string().max(64) }),
        body: toggleModuleSchema,
        response: { 200: moduleInfoSchema },
      },
    },
    async (req) => {
      const { moduleId } = req.params;
      await kernel.registry.setEnabled(moduleId, req.body.enabled, req.auth.user?.id ?? null, kernel.redis);
      const action = req.body.enabled ? 'core.module.enabled' : 'core.module.disabled';
      await ctx.audit.record({
        action,
        category: 'system',
        entityType: 'module',
        entityId: moduleId,
        entityLabel: moduleId,
      });
      await ctx.events.publish(action, { moduleId });
      return moduleInfo(kernel.registry.get(moduleId)!);
    },
  );

  app.put(
    '/modules/:moduleId/settings',
    {
      config: { permission: 'core.modules.manage' },
      schema: {
        tags: ['Modules'],
        summary: 'Update module settings',
        params: z.object({ moduleId: z.string().max(64) }),
        body: updateModuleSettingsSchema,
        response: { 200: moduleInfoSchema },
      },
    },
    async (req) => {
      const m = kernel.registry.get(req.params.moduleId);
      if (!m) throw httpErrors.notFound('Module not installed');
      const changes = await kernel.settings.update(m.manifest, req.body.values, req.auth.user?.id ?? null);
      await ctx.audit.record({
        action: 'core.module.settings_updated',
        category: 'system',
        entityType: 'module',
        entityId: m.manifest.id,
        changes,
      });
      return moduleInfo(m);
    },
  );

  /* ───────────── identity providers ───────────── */

  const iTags = ['Identity providers'];
  app.get(
    '/identity-providers',
    {
      config: { permission: 'core.idp.read' },
      schema: {
        tags: iTags,
        summary: 'List SSO / directory providers',
        response: { 200: z.object({ items: z.array(idpSchema) }) },
      },
    },
    async () => ({ items: await idps.list() }),
  );
  app.post(
    '/identity-providers',
    {
      config: { permission: 'core.idp.manage' },
      schema: { tags: iTags, summary: 'Add a provider', body: createIdpSchema, response: { 201: idpSchema } },
    },
    async (req, reply) => reply.status(201).send(await idps.create(req.body, req.auth)),
  );
  app.get(
    '/identity-providers/:id',
    {
      config: { permission: 'core.idp.read' },
      schema: { tags: iTags, summary: 'Provider details', params: idParams, response: { 200: idpSchema } },
    },
    async (req) => idps.get(req.params.id),
  );
  app.patch(
    '/identity-providers/:id',
    {
      config: { permission: 'core.idp.manage' },
      schema: {
        tags: iTags,
        summary: 'Update a provider (omitted secrets are kept)',
        params: idParams,
        body: updateIdpSchema,
        response: { 200: idpSchema },
      },
    },
    async (req) => idps.update(req.params.id, req.body, req.auth),
  );
  app.delete(
    '/identity-providers/:id',
    {
      config: { permission: 'core.idp.manage' },
      schema: { tags: iTags, summary: 'Remove a provider', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      await idps.remove(req.params.id);
      return { ok: true as const };
    },
  );
  app.post(
    '/identity-providers/:id/test',
    {
      config: { permission: 'core.idp.manage' },
      schema: {
        tags: iTags,
        summary: 'Test connectivity',
        params: idParams,
        response: { 200: idpTestResultSchema },
      },
    },
    async (req) => idps.test(req.params.id),
  );
  app.post(
    '/identity-providers/:id/sync',
    {
      config: { permission: 'core.idp.manage' },
      schema: {
        tags: iTags,
        summary: 'Queue an LDAP directory sync now',
        params: idParams,
        response: { 202: z.object({ jobId: z.string() }) },
      },
    },
    async (req, reply) => {
      const idp = await idps.find(req.params.id);
      if (idp.type !== 'ldap')
        throw new HttpError(400, 'BAD_REQUEST', 'Only LDAP providers support directory sync');
      const jobId = await ctx.jobs.enqueue('sync-directory', { idpId: idp.id });
      return reply.status(202).send({ jobId });
    },
  );

  /* ───────────── shell: navigation, search, dashboard ───────────── */

  app.get(
    '/platform/navigation',
    {
      schema: {
        tags: ['Platform'],
        summary:
          'The sidebar for the current user (enabled modules × permissions) and the Administration hub entries',
        response: { 200: navigationSchema },
      },
    },
    async (req) => kernel.navigation(req.auth),
  );

  app.get(
    '/platform/frame-ancestors',
    {
      // Asked by the web proxy before it serves a module's public page.
      config: { public: true, rateLimit: { max: 6000, timeWindow: '1 minute' } },
      schema: {
        tags: ['Platform'],
        summary: "Websites that may frame a module's public page (`/p/<module>/…`), for its frame-ancestors",
        querystring: z.object({ path: z.string().max(500) }),
        response: { 200: z.object({ origins: z.array(z.string()) }) },
      },
    },
    async (req) => {
      const match = /^\/p\/([a-z][a-z0-9-]*)(\/.*)?$/.exec(req.query.path);
      const m = match ? kernel.registry.get(match[1]!) : undefined;
      if (!m?.frameAncestors || !kernel.registry.isEnabled(m.manifest.id)) return { origins: [] };
      try {
        const origins = await m.frameAncestors(match![2] ?? '/', kernel.registry.context(m.manifest.id));
        // They go into a CSP header: plain origins only, whatever the module returned.
        return { origins: origins.filter((o) => FRAME_ORIGIN.test(o)) };
      } catch (err) {
        req.log.warn({ err, path: req.query.path }, 'frame-ancestors check failed');
        return { origins: [] };
      }
    },
  );

  app.get(
    '/platform/search',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['Platform'],
        summary: 'Global search across enabled modules (command palette)',
        querystring: z.object({
          q: z.string().trim().min(1).max(100),
          limit: z.coerce.number().int().min(1).max(20).default(6),
        }),
        response: { 200: searchResponseSchema },
      },
    },
    async (req) => {
      const started = performance.now();
      const hits = await kernel.search(req.query.q, req.auth, req.query.limit);
      return { hits, tookMs: Math.round(performance.now() - started) };
    },
  );

  app.get(
    '/platform/dashboard',
    {
      schema: {
        tags: ['Platform'],
        summary: 'Dashboard figures the current user may see',
        response: { 200: dashboardSchema },
      },
    },
    async (req) => {
      const canPeople = req.auth.permissions.hasAny('core.users.read');
      const canAudit = req.auth.can('core.audit.read');
      const zero = Promise.resolve([{ n: 0 }]);
      const in7days = new Date(Date.now() + 7 * 86_400_000);
      const [usersAll, active, pending, groupsN, rolesN, depts, sessionsN, expiring] = await Promise.all([
        canPeople ? ctx.db.select({ n: count() }).from(users) : zero,
        canPeople ? ctx.db.select({ n: count() }).from(users).where(eq(users.status, 'active')) : zero,
        canPeople ? ctx.db.select({ n: count() }).from(users).where(eq(users.status, 'pending')) : zero,
        canPeople ? ctx.db.select({ n: count() }).from(groups) : zero,
        canPeople ? ctx.db.select({ n: count() }).from(roles) : zero,
        ctx.db.select({ n: count() }).from(departments),
        canPeople
          ? ctx.db
              .select({ n: count() })
              .from(sessions)
              .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
          : zero,
        canPeople
          ? ctx.db
              .select({ n: count() })
              .from(roleAssignments)
              .where(and(gt(roleAssignments.expiresAt, new Date()), lte(roleAssignments.expiresAt, in7days)))
          : zero,
      ]);
      const bySource = canPeople
        ? await ctx.db
            .select({ source: users.authSource, n: count() })
            .from(users)
            .where(eq(users.status, 'active'))
            .groupBy(users.authSource)
        : [];
      let activity: { date: string; total: number; security: number }[] = [];
      let recent: ReturnType<typeof auditDto>[] = [];
      if (canAudit) {
        const res = await ctx.db.execute<{ day: string; total: number; security: number }>(sql`
          select to_char(d.day, 'YYYY-MM-DD') as day,
                 coalesce(count(a.seq), 0)::int as total,
                 coalesce(count(a.seq) filter (where a.category = 'security'), 0)::int as security
            from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as d(day)
            left join core.audit_logs a on a.occurred_at >= d.day and a.occurred_at < d.day + interval '1 day'
           group by d.day order by d.day`);
        activity = res.rows.map((r) => ({
          date: r.day,
          total: Number(r.total),
          security: Number(r.security),
        }));
        recent = (await ctx.db.select().from(auditLogs).orderBy(desc(auditLogs.seq)).limit(8)).map(auditDto);
      }
      const all = kernel.registry.modules;
      return {
        counts: {
          users: usersAll[0]!.n,
          activeUsers: active[0]!.n,
          pendingUsers: pending[0]!.n,
          groups: groupsN[0]!.n,
          roles: rolesN[0]!.n,
          departments: depts[0]!.n,
          modules: all.length,
          enabledModules: kernel.registry.enabledModules().length,
          activeSessions: sessionsN[0]!.n,
          expiringAssignments: expiring[0]!.n,
        },
        activity,
        usersBySource: bySource.map((r) => ({ source: r.source, count: r.n })),
        recent,
      };
    },
  );

  app.get(
    '/platform/ai-tools',
    {
      schema: {
        tags: ['Platform'],
        summary: 'AI tools the current identity may call (served by the MCP gateway in Phase 5)',
        response: {
          200: z.object({
            items: z.array(
              z.object({
                name: z.string(),
                description: z.string(),
                moduleId: z.string(),
                destructive: z.boolean(),
                input: z.unknown(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => ({
      items: kernel.registry.enabledModules().flatMap((m) =>
        (m.manifest.ai?.tools ?? [])
          .filter((t) => req.auth.permissions.hasAny(t.permission))
          .map((t) => ({
            name: t.name,
            description: t.description,
            moduleId: m.manifest.id,
            destructive: t.destructive ?? false,
            input: z.toJSONSchema(t.input),
          })),
      ),
    }),
  );
}
