import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { ErrorCodes, HttpError, type ModuleRouter } from '@isbp/sdk/server';
import scalar from '@scalar/fastify-api-reference';
import Fastify, { LogController } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { registerAuth } from './kernel/http/auth';
import { registerErrorHandling } from './kernel/http/errors';
import { scaleRouteRateLimits } from './kernel/http/route-rate-limit';
import { API_VERSION, type Kernel } from './kernel/kernel';
import { httpDuration } from './kernel/metrics';
import { loggerOptions } from './logger';

const PUBLIC_PREFIXES = ['/api/docs', '/api/openapi.json', '/healthz', '/readyz'];

export async function buildApp(kernel: Kernel) {
  const { config } = kernel;
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576,
    // One structured line per request is written by the onResponse hook below.
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: 'x-request-id',
    genReqId: () => uuidv7(),
    routerOptions: { ignoreTrailingSlash: true },
    // Server-Sent Events (notifications, assistant answers) never finish on their own: close them on shutdown so
    // the process can exit; clients reconnect to another replica.
    forceCloseConnections: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // Infra routes (docs, probes) are public; everything else is authenticated by default.
  app.addHook('onRoute', (route) => {
    if (PUBLIC_PREFIXES.some((p) => route.url.startsWith(p)))
      route.config = { ...route.config, public: true };
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // JSON API; the web app sets a strict, nonce-based CSP
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie);
  await app.register(formbody);
  // Uploads only (`/records/:type/:id/files`); the file store enforces the configurable size limit.
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 + 1, files: 1, fields: 10, parts: 12, headerPairs: 200 },
  });

  registerAuth(app, kernel);

  // Before the rate-limit plugin below reads the routes' own limits (see route-rate-limit.ts).
  if (config.RATE_LIMIT_ROUTE_SCALE !== 1) {
    app.log.warn(
      { scale: config.RATE_LIMIT_ROUTE_SCALE },
      'Per-route rate limits are multiplied (RATE_LIMIT_ROUTE_SCALE)',
    );
    app.addHook('onRoute', scaleRouteRateLimits(config.RATE_LIMIT_ROUTE_SCALE));
  }

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    hook: 'preHandler',
    redis: kernel.redis,
    nameSpace: 'isbp:rl:',
    keyGenerator: (req) => req.auth?.user?.id ?? req.auth?.client?.id ?? req.ip,
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, ErrorCodes.RATE_LIMITED, `Too many requests — retry in ${ctx.after}`),
  });

  if (config.apiDocs) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'IS Big Platform API',
          version: API_VERSION,
          description:
            'Every UI action is backed by this API. Browsers authenticate with the session cookie; unsafe ' +
            'methods then require the `x-csrf-token` header. API clients (Role Query API, automation) send ' +
            '`Authorization: Bearer <API key>` or an OAuth 2.0 client-credentials token from ' +
            '`POST /api/v1/oauth/token`.',
        },
        servers: [{ url: config.PUBLIC_URL }],
        components: {
          securitySchemes: {
            session: { type: 'apiKey', in: 'cookie', name: 'isbp_session' },
            csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
            apiKey: { type: 'http', scheme: 'bearer', description: 'API key `isbp_sk_…` of an API client' },
            oauth: {
              type: 'oauth2',
              flows: {
                clientCredentials: {
                  tokenUrl: '/api/v1/oauth/token',
                  scopes: { 'role-query': 'Query roles and permissions', api: 'Call the platform API' },
                },
              },
            },
          },
        },
        security: [{ session: [], csrf: [] }, { apiKey: [] }, { oauth: [] }],
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });
    await app.register(scalar, {
      routePrefix: '/api/docs',
      configuration: {
        theme: 'default',
        hideClientButton: false,
        metaData: { title: 'IS Big Platform API' },
      },
    });
    app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());
  }

  app.get('/healthz', { schema: { hide: true } }, () => ({ status: 'ok' }));
  app.get('/readyz', { schema: { hide: true } }, async (_req, reply) => {
    const ok = await kernel.ready().catch(() => false);
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'unavailable' });
  });

  // Mount every installed module through the same SDK contract. Core is the platform's own module
  // and is mounted at the API root; every other module lives under /api/v1/<id>.
  for (const mod of kernel.registry.modules) {
    if (!mod.routes) continue;
    const id = mod.manifest.id;
    const prefix = id === 'core' ? '/api/v1' : `/api/v1/${id}`;
    await app.register(
      async (scope) => {
        scope.addHook('onRoute', (route) => {
          route.schema = { ...route.schema, tags: route.schema?.tags ?? [id] };
        });
        if (!mod.manifest.system) {
          scope.addHook('onRequest', async () => {
            if (!kernel.registry.isEnabled(id)) {
              throw new HttpError(404, ErrorCodes.MODULE_DISABLED, `Module "${id}" is disabled`);
            }
          });
        }
        await mod.routes!(scope as unknown as ModuleRouter, kernel.registry.context(id));
      },
      { prefix },
    );
  }

  // MCP server for outside agents (API clients holding core.mcp.use): docs/architecture.md §13.4.
  const mcp = kernel.mcp;
  const webOrigin = new URL(kernel.config.PUBLIC_URL).origin;
  app.post(
    '/api/v1/mcp',
    {
      config: { permission: 'core.mcp.use' },
      schema: {
        tags: ['MCP'],
        summary: 'Model Context Protocol endpoint (Streamable HTTP) for outside agents',
        description:
          'JSON-RPC 2.0 over POST. Revision 2026-07-28 (stateless, `server/discover`) and the initialize-based ' +
          'revisions 2025-11-25, 2025-06-18 and 2025-03-26. API clients only.',
      },
    },
    async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && origin !== webOrigin)
        return reply
          .status(403)
          .send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Origin not allowed' } });
      if (req.auth.principal.type !== 'service')
        return reply
          .status(403)
          .send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'MCP is for API clients' } });
      const res = await mcp.handle({ headers: req.headers, body: req.body, auth: req.auth });
      return res.body === undefined
        ? reply.status(res.status).send()
        : reply.status(res.status).send(res.body);
    },
  );
  app.route({
    method: ['GET', 'DELETE'],
    url: '/api/v1/mcp',
    config: { permission: 'core.mcp.use' },
    schema: { hide: true },
    handler: (_req, reply) => reply.status(405).header('allow', 'POST').send(),
  });

  app.addHook('onResponse', (req, reply, done) => {
    const route = req.routeOptions.url ?? 'unmatched';
    const seconds = reply.elapsedTime / 1000;
    httpDuration.observe({ method: req.method, route, status_code: reply.statusCode }, seconds);
    if (route !== '/healthz' && route !== '/readyz') {
      req.log.info(
        {
          method: req.method,
          route,
          url: req.url,
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
          user: req.auth?.user?.id,
        },
        'request',
      );
    }
    done();
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
