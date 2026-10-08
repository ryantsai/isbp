import { fileURLToPath } from 'node:url';
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

    /** Attachments: a directory (`local`, a mounted volume in containers) or an S3-compatible bucket. */
    FILES_STORAGE: z.enum(['local', 's3']).default('local'),
    FILES_DIR: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    /** For MinIO/Ceph and other S3-compatible stores. */
    S3_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    S3_FORCE_PATH_STYLE: bool.optional(),
    /** Optional: without them the AWS default chain is used (IAM role, IRSA, env, profile). */
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PREFIX: z.string().default('files/'),
    S3_SSE: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['AES256', 'aws:kms']).optional()),
    /** ClamAV `clamd` for malware scanning of uploads (fail closed when set but unreachable). */
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().default(3310),

    /**
     * Where script jobs run: `kubernetes` (Jobs in SANDBOX_K8S_NAMESPACE), `docker` (Engine API at
     * SANDBOX_DOCKER_HOST), `local` (development only, not isolated) or `none`. Default: `local` outside
     * production, `none` in production.
     */
    SANDBOX_RUNNER: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['none', 'local', 'docker', 'kubernetes']).optional(),
    ),
    /** Allowed container images, comma-separated. */
    SANDBOX_IMAGES: z
      .string()
      .default('python:3.14-alpine,node:24-alpine,mcr.microsoft.com/powershell:lts-alpine-3.20,alpine:3.24'),
    SANDBOX_DOCKER_HOST: z.string().default('unix:///var/run/docker.sock'),
    SANDBOX_K8S_NAMESPACE: z.string().default('isbp-sandbox'),
    SANDBOX_K8S_API: z.string().default('https://kubernetes.default.svc'),
    SANDBOX_K8S_TOKEN_FILE: z.string().default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
    SANDBOX_K8S_CA_FILE: z.string().default('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),
  })
  .transform((env) => {
    const isProd = env.NODE_ENV === 'production';
    if (isProd && !env.ISBP_MASTER_KEY) {
      throw new Error('ISBP_MASTER_KEY is required in production (base64-encoded 32 random bytes).');
    }
    const masterKey = env.ISBP_MASTER_KEY ?? DEV_MASTER_KEY;
    if (env.FILES_STORAGE === 's3' && !env.S3_BUCKET)
      throw new Error('S3_BUCKET is required when FILES_STORAGE=s3.');
    const sandboxRunner = env.SANDBOX_RUNNER ?? (isProd ? 'none' : 'local');
    if (isProd && sandboxRunner === 'local')
      throw new Error('SANDBOX_RUNNER=local runs scripts without isolation and is refused in production.');
    // Development keeps files next to the embedded database (`.dev-data/` at the repo root).
    const filesDir =
      env.FILES_DIR ??
      (isProd ? '/var/lib/isbp/files' : fileURLToPath(new URL('../../../.dev-data/files', import.meta.url)));
    return {
      ...env,
      isProd,
      isTest: env.NODE_ENV === 'test',
      masterKey,
      filesDir,
      sandboxRunner,
      sandboxImages: env.SANDBOX_IMAGES.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
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
