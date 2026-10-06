import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const DEV_MASTER_KEY = 'ZGV2LW9ubHktbWFzdGVyLWtleS1kby1ub3QtdXNlISE='; // 32 bytes, dev/test only

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().default(4000),
    METRICS_PORT: z.coerce.number().int().default(9464),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_PRETTY: bool.optional(),

    DATABASE_URL: z.string().default('postgres://isbp:isbp@localhost:5432/isbp'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AUTO_MIGRATE: bool.optional(),

    /** Public origin of the web app (SSO redirect URIs, cookie `Secure` flag). */
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    TRUST_PROXY: z.string().default('loopback,linklocal,uniquelocal'),

    /** Base64 32-byte key for secrets at rest; `ISBP_MASTER_KEY_PREVIOUS` allows rotation. */
    ISBP_MASTER_KEY: z.string().optional(),
    ISBP_MASTER_KEY_PREVIOUS: z.string().optional(),

    SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
    SESSION_REMEMBER_DAYS: z.coerce.number().positive().default(14),
    SESSION_IDLE_MINUTES: z.coerce.number().positive().default(240),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1200),

    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
    API_DOCS: bool.optional(),
    /** Let notification webhooks target private/loopback addresses (default: only outside production). */
    ISBP_ALLOW_PRIVATE_WEBHOOKS: bool.optional(),
    /** OAuth client-credentials access token lifetime. */
    OAUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  })
  .transform((env) => {
    const isProd = env.NODE_ENV === 'production';
    if (isProd && !env.ISBP_MASTER_KEY) {
      throw new Error('ISBP_MASTER_KEY is required in production (base64-encoded 32 random bytes).');
    }
    const masterKey = env.ISBP_MASTER_KEY ?? DEV_MASTER_KEY;
    return {
      ...env,
      isProd,
      isTest: env.NODE_ENV === 'test',
      masterKey,
      usingDevMasterKey: masterKey === DEV_MASTER_KEY,
      autoMigrate: env.AUTO_MIGRATE ?? !isProd,
      logPretty: env.LOG_PRETTY ?? (!isProd && process.stdout.isTTY),
      apiDocs: env.API_DOCS ?? true,
      allowPrivateWebhooks: env.ISBP_ALLOW_PRIVATE_WEBHOOKS ?? !isProd,
      cookieSecure: env.PUBLIC_URL.startsWith('https://'),
      trustProxy: env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY,
    };
  });

export type Config = z.output<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
