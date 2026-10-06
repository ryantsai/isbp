import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  PermissionSet,
  type Principal,
  type ResourceScope,
} from '@isbp/sdk/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createAuditService } from '../audit';
import { ANONYMOUS_PRINCIPAL, runWithContext, setPrincipal } from '../context';
import { safeEqual } from '../crypto';
import type { Kernel } from '../kernel';
import { SESSION_COOKIE, type SessionRow, toSessionUser, type UserRow } from '../sessions';

declare module 'fastify' {
  interface FastifyRequest {
    sessionRow: SessionRow | null;
    userRow: UserRow | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function buildAuthContext(
  principal: Principal,
  user: AuthContext['user'],
  sessionId: string | null,
  permissions: PermissionSet,
  onDenied: (permission: string, resource?: ResourceScope) => void = () => undefined,
): AuthContext {
  return {
    principal,
    user,
    sessionId,
    permissions,
    can: (permission, resource) => permissions.can(permission, resource),
    require(permission, resource) {
      if (!permissions.can(permission, resource)) {
        onDenied(permission, resource);
        throw httpErrors.forbidden();
      }
    },
    reach: (permission) => permissions.reach(permission),
  };
}

export const anonymousAuth = buildAuthContext(ANONYMOUS_PRINCIPAL, null, null, PermissionSet.empty());

/**
 * Authentication, CSRF and route-level permission guard — secure by default:
 * every route needs a session unless `config.public`, and declared permissions are enforced before
 * the handler runs (global grant required unless the route is `scoped`).
 */
export function registerAuth(app: FastifyInstance, kernel: Kernel) {
  const audit = createAuditService(kernel.db, 'core');

  app.decorateRequest('auth', null as unknown as AuthContext);
  app.decorateRequest('sessionRow', null);
  app.decorateRequest('userRow', null);

  // Establish the async context first (callback style so it propagates into later hooks + handler).
  app.addHook('onRequest', (req, _reply, done) => {
    runWithContext(
      { principal: ANONYMOUS_PRINCIPAL, requestId: req.id, ip: req.ip, userAgent: req.headers['user-agent'] },
      () => done(),
    );
  });

  const denied = (req: FastifyRequest, permission: string, resource?: ResourceScope) => {
    void audit
      .record({
        action: 'core.access.denied',
        category: 'security',
        outcome: 'denied',
        metadata: { permission, resource, method: req.method, route: req.routeOptions.url },
      })
      .catch((err) => req.log.error({ err }, 'failed to audit access denial'));
  };

  app.addHook('onRequest', async (req, reply) => {
    req.auth = anonymousAuth;
    const config = req.routeOptions.config ?? {};

    const token = req.cookies[SESSION_COOKIE];
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (bearer && !token) {
      // API clients (Role Query API, automation): service principals with their own grants.
      const result = await kernel.apiClients.authenticate(bearer, req.ip);
      if (!result) {
        void audit
          .record({
            action: 'core.api-client.auth_failed',
            category: 'security',
            outcome: 'failure',
            metadata: { route: req.routeOptions.url, method: req.method },
          })
          .catch((err) => req.log.error({ err }, 'failed to audit API client failure'));
        throw new HttpError(401, ErrorCodes.UNAUTHENTICATED, 'Invalid or expired API credentials');
      }
      const principal: Principal = {
        type: 'service',
        id: result.client.id,
        name: `client:${result.client.name}`,
      };
      req.auth = buildAuthContext(principal, null, null, result.permissions, (p, r) => denied(req, p, r));
      req.auth.client = { id: result.client.id, clientId: result.client.clientId, name: result.client.name };
      setPrincipal(principal);
    } else if (token) {
      const valid = await kernel.sessions.validate(token);
      if (valid) {
        const user = toSessionUser(valid.user);
        const principal: Principal = { type: 'user', id: user.id, name: user.displayName };
        const permissions = await kernel.rbac.permissionsFor(user.id);
        req.sessionRow = valid.session;
        req.userRow = valid.user;
        req.auth = buildAuthContext(principal, user, valid.session.id, permissions, (p, r) =>
          denied(req, p, r),
        );
        setPrincipal(principal);
      } else {
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
      }
    }

    if (config.public) return;
    const service = req.auth.principal.type === 'service' && req.auth.client;
    if (!req.auth.user && !service)
      throw new HttpError(401, ErrorCodes.UNAUTHENTICATED, 'Authentication required');
    // Personal routes (`/me`, navigation, …) declare no permission and are for people only.
    if (service && !config.permission) {
      denied(req, 'personal-route');
      throw httpErrors.forbidden('API clients can only call routes that declare a permission');
    }

    if (req.sessionRow && !SAFE_METHODS.has(req.method) && config.csrf !== false) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, req.sessionRow.csrfToken)) {
        throw new HttpError(403, ErrorCodes.CSRF_INVALID, 'Missing or invalid CSRF token');
      }
    }

    if (config.permission) {
      const required = Array.isArray(config.permission) ? config.permission : [config.permission];
      for (const permission of required) {
        const ok = config.scoped ? req.auth.permissions.hasAny(permission) : req.auth.can(permission);
        if (!ok) {
          denied(req, permission);
          throw httpErrors.forbidden();
        }
      }
    }
  });
}
