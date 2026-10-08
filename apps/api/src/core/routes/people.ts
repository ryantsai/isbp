import {
  changePasswordSchema,
  createUserSchema,
  effectivePermissionsSchema,
  meSchema,
  offboardUserSchema,
  okSchema,
  resetPasswordSchema,
  sessionInfoSchema,
  setUserStatusSchema,
  updateMeSchema,
  updateUserSchema,
  userDetailSchema,
  userListQuerySchema,
  userSummarySchema,
} from '@isbp/contracts';
import { personLookupQuerySchema, personLookupSchema } from '@isbp/contracts';
import { departments, users } from '@isbp/db/schema';
import { LOCALE_COOKIE } from '@isbp/i18n';
import {
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
  type ModuleRouter,
  pageSchema,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../kernel/passwords';
import { getKernel } from '../kernel-ref';
import { reachFilter } from '../util';
import type { AccessService } from '../services/access';
import type { UserService } from '../services/users';
import { meDto } from './auth';

const idParams = z.object({ id: z.uuid() });

export function meRoutes(app: ModuleRouter, ctx: ModuleContext, access: AccessService) {
  const kernel = getKernel();
  const tags = ['Me'];

  /**
   * Colleague lookup for pickers (form "person" fields, delegation): active people, minimal profile. With
   * `includePreboarded`, also the pre-boarded people the caller may request access for (so it is ready on day one).
   */
  app.get(
    '/people/lookup',
    {
      schema: {
        tags: ['People'],
        summary: 'Find active colleagues by name, email or username (or resolve ids)',
        querystring: personLookupQuerySchema,
        response: { 200: z.object({ items: z.array(personLookupSchema) }) },
      },
    },
    async (req) => {
      const { q, ids, includePreboarded } = req.query;
      if (!q && !ids?.length) return { items: [] };
      const me = req.auth.user?.id;
      // The same people AccessRequestService.assertMayRequestFor accepts: direct reports, or role-assign reach.
      const assignReach = req.auth.reach('core.roles.assign');
      const preboarded =
        includePreboarded && me
          ? and(
              eq(users.status, 'pending'),
              assignReach.global
                ? undefined
                : or(eq(users.managerId, me), reachFilter(assignReach, users.departmentId, users.id, 'user')),
            )
          : undefined;
      const rows = await ctx.db
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          jobTitle: users.jobTitle,
          avatarUrl: users.avatarUrl,
          department: departments.name,
          status: sql<'active' | 'pending'>`${users.status}`,
        })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(
          and(
            preboarded ? or(eq(users.status, 'active'), preboarded) : eq(users.status, 'active'),
            ids?.length ? inArray(users.id, ids) : undefined,
            q
              ? or(
                  ilike(users.displayName, likePattern(q)),
                  ilike(users.email, likePattern(q)),
                  ilike(users.username, likePattern(q)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(users.displayName))
        .limit(ids?.length ? 50 : 10);
      return { items: rows };
    },
  );

  app.get('/me', { schema: { tags, summary: 'My profile', response: { 200: meSchema } } }, async (req) =>
    meDto(req.userRow!),
  );

  app.patch(
    '/me',
    {
      schema: {
        tags,
        summary: 'Update my profile and preferences',
        body: updateMeSchema,
        response: { 200: meSchema },
      },
    },
    async (req, reply) => {
      const me = req.userRow!;
      const { preferences, ...rest } = req.body;
      const patch = {
        ...rest,
        ...(preferences ? { preferences: { ...me.preferences, ...preferences } } : {}),
      };
      const [updated] = await ctx.db.update(users).set(patch).where(eq(users.id, me.id)).returning();
      if (rest.locale)
        reply.setCookie(LOCALE_COOKIE, rest.locale, { path: '/', sameSite: 'lax', maxAge: 31_536_000 });
      const changes = ctx.audit.diff(
        me as unknown as Record<string, unknown>,
        rest as Record<string, unknown>,
      );
      if (Object.keys(changes).length) {
        await ctx.audit.record({
          action: 'core.user.profile_updated',
          entityType: 'user',
          entityId: me.id,
          entityLabel: updated!.displayName,
          changes,
        });
      }
      return meDto(updated!);
    },
  );

  app.post(
    '/me/password',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Change my password (local accounts)',
        body: changePasswordSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      const me = req.userRow!;
      if (me.authSource !== 'local' || !me.passwordHash) {
        throw new HttpError(
          409,
          'PASSWORD_MANAGED_EXTERNALLY',
          'Your password is managed by your identity provider',
        );
      }
      if (!(await verifyPassword(me.passwordHash, req.body.currentPassword))) {
        throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }
      await ctx.db
        .update(users)
        .set({ passwordHash: await hashPassword(req.body.newPassword), mustChangePassword: false })
        .where(eq(users.id, me.id));
      await kernel.sessions.revokeAllForUser(me.id, 'password_changed', req.sessionRow!.id);
      await ctx.audit.record({
        action: 'core.user.password_changed',
        category: 'security',
        entityType: 'user',
        entityId: me.id,
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/me/sessions',
    {
      schema: {
        tags,
        summary: 'My active sessions',
        response: { 200: z.object({ items: z.array(sessionInfoSchema) }) },
      },
    },
    async (req) => {
      const rows = await kernel.sessions.listActive(req.userRow!.id);
      return {
        items: rows.map((s) => ({
          id: s.id,
          ip: s.ip,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
          current: s.id === req.sessionRow!.id,
        })),
      };
    },
  );

  app.delete(
    '/me/sessions/:id',
    {
      schema: { tags, summary: 'Sign out one of my sessions', params: idParams, response: { 200: okSchema } },
    },
    async (req) => {
      const mine = await kernel.sessions.listActive(req.userRow!.id);
      if (!mine.some((s) => s.id === req.params.id)) throw httpErrors.notFound('Session not found');
      await kernel.sessions.revoke(req.params.id, 'user_revoked');
      await ctx.audit.record({
        action: 'core.auth.session_revoked',
        category: 'security',
        entityType: 'user',
        entityId: req.userRow!.id,
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/me/permissions',
    {
      schema: {
        tags,
        summary: 'Explain my effective permissions',
        response: { 200: effectivePermissionsSchema },
      },
    },
    async (req) => access.effectivePermissions(req.userRow!.id),
  );
}

export function userRoutes(app: ModuleRouter, _ctx: ModuleContext, svc: UserService, access: AccessService) {
  const tags = ['Users'];

  app.get(
    '/users',
    {
      config: { permission: 'core.users.read', scoped: true },
      schema: {
        tags,
        summary: 'List people (server-side paging, search, filters)',
        querystring: userListQuerySchema,
        response: { 200: pageSchema(userSummarySchema) },
      },
    },
    async (req) => svc.list(req.query, req.auth),
  );

  app.post(
    '/users',
    {
      config: { permission: 'core.users.create', scoped: true },
      schema: {
        tags,
        summary: 'Create a person (local account or pre-boarded)',
        body: createUserSchema,
        response: { 201: userDetailSchema },
      },
    },
    async (req, reply) => {
      const user = await svc.create(req.body, req.auth);
      return reply.status(201).send(await svc.detail(user.id, req.auth));
    },
  );

  app.get(
    '/users/:id',
    {
      config: { permission: 'core.users.read', scoped: true },
      schema: { tags, summary: 'Person details', params: idParams, response: { 200: userDetailSchema } },
    },
    async (req) => svc.detail(req.params.id, req.auth),
  );

  app.patch(
    '/users/:id',
    {
      config: { permission: 'core.users.update', scoped: true },
      schema: {
        tags,
        summary: 'Update a person',
        params: idParams,
        body: updateUserSchema,
        response: { 200: userDetailSchema },
      },
    },
    async (req) => {
      await svc.update(req.params.id, req.body, req.auth);
      return svc.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/users/:id/onboard',
    {
      config: { permission: 'core.users.lifecycle', scoped: true },
      schema: {
        tags,
        summary: 'Activate a pre-boarded (or re-hire an offboarded) person',
        params: idParams,
        response: { 200: userDetailSchema },
      },
    },
    async (req) => {
      await svc.onboard(req.params.id, req.auth);
      return svc.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/users/:id/offboard',
    {
      config: { permission: 'core.users.lifecycle', scoped: true },
      schema: {
        tags,
        summary: 'Offboard: disable sign-in, revoke sessions, remove access',
        params: idParams,
        body: offboardUserSchema,
        response: {
          200: z.object({
            reason: z.string().nullable(),
            revokedSessions: z.number(),
            removedGroups: z.number(),
            removedRoles: z.number(),
            transferredReports: z.number(),
          }),
        },
      },
    },
    async (req) => svc.offboard(req.params.id, req.body, req.auth),
  );

  app.post(
    '/users/:id/status',
    {
      config: { permission: 'core.users.lifecycle', scoped: true },
      schema: {
        tags,
        summary: 'Suspend or reactivate',
        params: idParams,
        body: setUserStatusSchema,
        response: { 200: userDetailSchema },
      },
    },
    async (req) => {
      await svc.setStatus(req.params.id, req.body.status, req.body.reason, req.auth);
      return svc.detail(req.params.id, req.auth);
    },
  );

  app.post(
    '/users/:id/password',
    {
      config: { permission: 'core.users.credentials', scoped: true },
      schema: {
        tags,
        summary: 'Set a new password for a local account',
        params: idParams,
        body: resetPasswordSchema,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      await svc.resetPassword(req.params.id, req.body, req.auth);
      return { ok: true as const };
    },
  );

  app.delete(
    '/users/:id/sessions',
    {
      config: { permission: 'core.users.lifecycle', scoped: true },
      schema: {
        tags,
        summary: 'Sign the person out everywhere',
        params: idParams,
        response: { 200: z.object({ revoked: z.number() }) },
      },
    },
    async (req) => ({ revoked: await svc.revokeSessions(req.params.id, req.auth) }),
  );

  app.get(
    '/users/:id/permissions',
    {
      config: { permission: 'core.roles.read' },
      schema: {
        tags,
        summary: 'Explain a person’s effective permissions',
        params: idParams,
        response: { 200: effectivePermissionsSchema },
      },
    },
    async (req) => access.effectivePermissions(req.params.id),
  );
}
