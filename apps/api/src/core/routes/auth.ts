import { authProviderPublicSchema, loginSchema, okSchema, sessionResponseSchema } from '@isbp/contracts';
import { identityProviders, users } from '@isbp/db/schema';
import { isLocale, LOCALE_COOKIE } from '@isbp/i18n';
import { HttpError, type ModuleContext, type ModuleRouter } from '@isbp/sdk/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomToken, safeEqual } from '../../kernel/crypto';
import { loginCounter } from '../../kernel/metrics';
import { verifyDummy, verifyPassword } from '../../kernel/passwords';
import { SESSION_COOKIE, type SessionRow, type UserRow } from '../../kernel/sessions';
import { getKernel } from '../kernel-ref';
import type { IdpService } from '../services/idp';
import { ldapAuthenticate } from '../sso/ldap';
import { oidcAuthorizationUrl, oidcCallback, type OidcState } from '../sso/oidc';
import { type ExternalIdentity, resolveExternalUser } from '../sso/provisioning';
import { samlClient, samlProfileToIdentity } from '../sso/saml';
import { safeNext } from '../util';

const SSO_COOKIE = 'isbp_sso';
const SSO_TTL_SECONDS = 600;

interface SsoState {
  idpId: string;
  next: string;
  remember: boolean;
  oidc?: OidcState;
}

export function meDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    locale: isLocale(u.locale) ? u.locale : ('en' as const),
    timezone: u.timezone,
    departmentId: u.departmentId,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    authSource: u.authSource,
    mustChangePassword: u.mustChangePassword,
    preferences: u.preferences,
  };
}

export async function sessionBody(user: UserRow, session: SessionRow) {
  const kernel = getKernel();
  const permissions = await kernel.rbac.permissionsFor(user.id);
  return {
    user: meDto(user),
    csrfToken: session.csrfToken,
    grants: [...permissions.grants],
    enabledModules: kernel.registry.enabledModules().map((m) => m.manifest.id),
    expiresAt: session.expiresAt,
  };
}

export function authRoutes(app: ModuleRouter, ctx: ModuleContext, idps: IdpService) {
  const kernel = getKernel();
  const tags = ['Auth'];

  async function establishSession(
    req: FastifyRequest,
    reply: FastifyReply,
    user: UserRow,
    opts: { remember: boolean; provider: string; idpId?: string | null },
  ) {
    const { token, session } = await kernel.sessions.create(user.id, {
      remember: opts.remember,
      idpId: opts.idpId ?? null,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    await ctx.db
      .update(users)
      .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
    reply.setCookie(SESSION_COOKIE, token, kernel.sessions.cookieOptions(session, opts.remember));
    if (isLocale(user.locale)) {
      reply.setCookie(LOCALE_COOKIE, user.locale, { path: '/', sameSite: 'lax', maxAge: 31_536_000 });
    }
    await ctx.audit.record(
      {
        action: 'core.auth.login',
        category: 'security',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.displayName,
        metadata: { provider: opts.provider, remember: opts.remember },
      },
      { principal: { type: 'user', id: user.id, name: user.displayName } },
    );
    loginCounter.inc({ provider: opts.provider, result: 'success' });
    return session;
  }

  async function loginFailed(username: string, provider: string, reason: string, user?: UserRow) {
    loginCounter.inc({ provider, result: 'failure' });
    await ctx.audit.record({
      action: 'core.auth.login_failed',
      category: 'security',
      outcome: 'failure',
      entityType: user ? 'user' : undefined,
      entityId: user?.id,
      entityLabel: user?.displayName ?? username.slice(0, 200),
      metadata: { provider, reason },
    });
  }

  const invalid = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');

  async function localLogin(username: string, password: string): Promise<UserRow> {
    const ident = username.trim().toLowerCase();
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${ident} or lower(${users.username}) = ${ident}`)
      .limit(1);
    if (!user || user.authSource !== 'local' || !user.passwordHash) {
      await verifyDummy(password);
      await loginFailed(username, 'local', 'unknown_user', user);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await loginFailed(username, 'local', 'locked', user);
      throw new HttpError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= kernel.config.LOGIN_MAX_ATTEMPTS;
      await ctx.db
        .update(users)
        .set({
          failedLoginCount: lock ? 0 : failures,
          lockedUntil: lock
            ? new Date(Date.now() + kernel.config.LOGIN_LOCK_MINUTES * 60_000)
            : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await loginFailed(username, 'local', lock ? 'bad_password_locked' : 'bad_password', user);
      throw invalid();
    }
    if (user.status !== 'active') {
      await loginFailed(username, 'local', `status_${user.status}`, user);
      throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active');
    }
    return user;
  }

  app.get(
    '/auth/providers',
    {
      config: { public: true },
      schema: {
        tags,
        summary: 'Sign-in options for the login page',
        response: {
          200: z.object({
            providers: z.array(authProviderPublicSchema),
            productName: z.string(),
            loginBanner: z.string().nullable(),
          }),
        },
      },
    },
    async () => {
      const rows = await ctx.db
        .select({ key: identityProviders.key, name: identityProviders.name, type: identityProviders.type })
        .from(identityProviders)
        .where(eq(identityProviders.enabled, true))
        .orderBy(asc(identityProviders.displayOrder), asc(identityProviders.name));
      const settings = await ctx.settings.all();
      return {
        providers: rows.map((p) => ({
          ...p,
          startUrl: p.type === 'ldap' ? null : `/api/v1/auth/sso/${p.key}/start`,
        })),
        productName: String(settings['branding.productName'] ?? 'IS Big Platform'),
        loginBanner: (settings['security.loginBanner'] as string | null) || null,
      };
    },
  );

  app.post(
    '/auth/login',
    {
      config: {
        public: true,
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) =>
            `login:${req.ip}:${String((req.body as { username?: string })?.username ?? '').toLowerCase()}`,
        },
      },
      schema: {
        tags,
        summary: 'Sign in with a local or LDAP account',
        body: loginSchema,
        response: { 200: sessionResponseSchema },
      },
    },
    async (req, reply) => {
      const { username, password, provider, remember } = req.body;
      let user: UserRow;
      let idpId: string | null = null;
      if (provider) {
        const idp = await idps.findEnabledByKey(provider);
        if (idp.type !== 'ldap')
          throw new HttpError(400, 'BAD_REQUEST', 'This provider does not accept passwords');
        let identity: ExternalIdentity;
        try {
          identity = await ldapAuthenticate(idp, idps.secrets(idp).bindPassword ?? '', username, password);
        } catch (err) {
          req.log.info({ err: (err as Error).message, provider }, 'ldap login failed');
          await loginFailed(username, 'ldap', 'ldap_bind_failed');
          throw invalid();
        }
        user = await resolveExternalUser(ctx, idp, identity);
        idpId = idp.id;
      } else {
        user = await localLogin(username, password);
      }
      const session = await establishSession(req, reply, user, {
        remember,
        provider: provider ? 'ldap' : 'local',
        idpId,
      });
      return sessionBody(user, session);
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags, summary: 'Sign out and revoke the current session', response: { 200: okSchema } } },
    async (req, reply) => {
      if (req.sessionRow) await kernel.sessions.revoke(req.sessionRow.id, 'logout');
      await ctx.audit.record({
        action: 'core.auth.logout',
        category: 'security',
        entityType: 'user',
        entityId: req.auth.user?.id,
      });
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
    },
  );

  app.get(
    '/auth/session',
    {
      schema: {
        tags,
        summary: 'Current user, permissions and CSRF token',
        response: { 200: sessionResponseSchema },
      },
    },
    async (req) => sessionBody(req.userRow!, req.sessionRow!),
  );

  /* ───────────── browser SSO (OIDC + SAML) ───────────── */

  const ssoFail = (reply: FastifyReply, code: string) =>
    reply.redirect(`/login?error=${encodeURIComponent(code)}`, 303);

  app.get(
    '/auth/sso/:key/start',
    {
      config: { public: true },
      schema: {
        tags,
        summary: 'Begin browser single sign-on',
        params: z.object({ key: z.string().max(64) }),
        querystring: z.object({
          next: z.string().max(1000).optional(),
          remember: z.stringbool().default(false),
        }),
      },
    },
    async (req, reply) => {
      const idp = await idps.findEnabledByKey(req.params.key);
      const state = randomToken(24);
      const payload: SsoState = {
        idpId: idp.id,
        next: safeNext(req.query.next),
        remember: req.query.remember,
      };
      let url: string;
      if (idp.type === 'oidc') {
        const redirectUri = idps.endpoints(idp).redirectUri!;
        const res = await oidcAuthorizationUrl(idp, idps.secrets(idp).clientSecret, redirectUri, state);
        payload.oidc = res.checks;
        url = res.url;
      } else if (idp.type === 'saml') {
        url = await samlClient(idp, kernel.config.PUBLIC_URL).getAuthorizeUrlAsync(state, undefined, {});
      } else {
        return ssoFail(reply, 'PROVIDER_NOT_BROWSER');
      }
      await kernel.redis.set(`isbp:sso:${state}`, JSON.stringify(payload), 'EX', SSO_TTL_SECONDS);
      reply.setCookie(SSO_COOKIE, state, {
        path: '/api/v1/auth/sso',
        httpOnly: true,
        sameSite: 'lax',
        secure: kernel.config.cookieSecure,
        maxAge: SSO_TTL_SECONDS,
      });
      return reply.redirect(url, 302);
    },
  );

  async function takeState(state: string | undefined): Promise<SsoState | null> {
    if (!state || state.length > 100) return null;
    const key = `isbp:sso:${state}`;
    const raw = await kernel.redis.getdel(key);
    return raw ? (JSON.parse(raw) as SsoState) : null;
  }

  app.get(
    '/auth/sso/:key/callback',
    {
      config: { public: true },
      schema: { tags, summary: 'OIDC redirect URI', params: z.object({ key: z.string().max(64) }) },
    },
    async (req, reply) => {
      const query = req.query as Record<string, string | undefined>;
      if (query.error) return ssoFail(reply, 'SSO_DENIED');
      const cookieState = req.cookies[SSO_COOKIE];
      reply.clearCookie(SSO_COOKIE, { path: '/api/v1/auth/sso' });
      if (!cookieState || !query.state || !safeEqual(cookieState, query.state))
        return ssoFail(reply, 'SSO_STATE');
      const state = await takeState(query.state);
      if (!state?.oidc) return ssoFail(reply, 'SSO_STATE');
      try {
        const idp = await idps.find(state.idpId);
        if (idp.key !== req.params.key || !idp.enabled) return ssoFail(reply, 'SSO_STATE');
        const currentUrl = new URL(req.url, kernel.config.PUBLIC_URL);
        const identity = await oidcCallback(
          idp,
          idps.secrets(idp).clientSecret,
          currentUrl,
          query.state,
          state.oidc,
        );
        const user = await resolveExternalUser(ctx, idp, identity);
        await establishSession(req, reply, user, {
          remember: state.remember,
          provider: 'oidc',
          idpId: idp.id,
        });
        return reply.redirect(state.next, 303);
      } catch (err) {
        req.log.warn({ err }, 'oidc callback failed');
        await loginFailed(req.params.key, 'oidc', (err as Error).message.slice(0, 200));
        return ssoFail(reply, err instanceof HttpError ? err.code : 'SSO_FAILED');
      }
    },
  );

  app.post(
    '/auth/sso/:key/acs',
    {
      config: { public: true, csrf: false },
      schema: {
        tags,
        summary: 'SAML assertion consumer service (HTTP-POST binding)',
        params: z.object({ key: z.string().max(64) }),
        body: z.object({ SAMLResponse: z.string().max(500_000), RelayState: z.string().max(200).optional() }),
      },
    },
    async (req, reply) => {
      const state = await takeState(req.body.RelayState);
      if (!state) return ssoFail(reply, 'SSO_STATE');
      try {
        const idp = await idps.find(state.idpId);
        if (idp.key !== req.params.key || !idp.enabled || idp.type !== 'saml')
          return ssoFail(reply, 'SSO_STATE');
        const { profile } = await samlClient(idp, kernel.config.PUBLIC_URL).validatePostResponseAsync({
          SAMLResponse: req.body.SAMLResponse,
        });
        if (!profile) return ssoFail(reply, 'SSO_FAILED');
        const user = await resolveExternalUser(ctx, idp, samlProfileToIdentity(idp, profile));
        await establishSession(req, reply, user, {
          remember: state.remember,
          provider: 'saml',
          idpId: idp.id,
        });
        return reply.redirect(state.next, 303);
      } catch (err) {
        req.log.warn({ err }, 'saml acs failed');
        await loginFailed(req.params.key, 'saml', (err as Error).message.slice(0, 200));
        return ssoFail(reply, err instanceof HttpError ? err.code : 'SSO_FAILED');
      }
    },
  );

  app.get(
    '/auth/sso/:key/metadata',
    {
      config: { public: true },
      schema: {
        tags,
        summary: 'SAML service-provider metadata',
        params: z.object({ key: z.string().max(64) }),
      },
    },
    async (req, reply) => {
      const [idp] = await ctx.db
        .select()
        .from(identityProviders)
        .where(and(eq(identityProviders.key, req.params.key), eq(identityProviders.type, 'saml')));
      if (!idp) throw new HttpError(404, 'NOT_FOUND', 'SAML provider not found');
      reply.type('application/samlmetadata+xml');
      return samlClient(idp, kernel.config.PUBLIC_URL).generateServiceProviderMetadata(null, null);
    },
  );
}
