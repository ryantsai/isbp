/**
 * Helpers for the platform's demo seed (`apps/api/src/seed-phase5.ts`) and tests. The hub has no demo data of
 * its own: connections point at outside systems (the mocks in development), so the platform seed creates them.
 *
 *   const { connection, webhookSecret } = await createConnection(ctx, { name, type: 'sdp.cloud', config, secrets });
 *   const profile = await createProfile(ctx, { connectionId: connection.id, name, objectType: 'request',
 *     entity: 'itsm.ticket', direction: 'both', mappings: 'default' });
 *   const run = await runPullNow(ctx, profile.id);          // a full pull, awaited
 *   await registerDemoWebhook(ctx, connection.id, 'known-secret'); // so a mock can call the webhook
 *
 * Every helper goes through the same services as the API (validation, audit, events). Without `auth` they
 * act as the hub itself (`integrations.*` and `*.*.sync`).
 */
import { type AuthContext, httpErrors, type ModuleContext, PermissionSet } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import {
  type ConnectionOut,
  createConnectionSchema,
  createProfileSchema,
  type CreateConnectionInput,
  type CreateProfileInput,
  type FieldMapping,
  type ProfileOut,
  type RunDetailOut,
} from '../contracts';
import { webhookPath } from '../model';
import { newWebhookSecret } from './connections';
import { connections } from './schema';
import { services } from './services';
import { createHash } from 'node:crypto';

/** The hub acting for itself (seeds, tests): every hub permission and every entity's `.sync`. */
export function hubAuth(name = 'Integrations Hub'): AuthContext {
  const permissions = new PermissionSet([
    { p: 'integrations.*', s: 'g' },
    { p: '*.*.sync', s: 'g' },
  ]);
  return {
    principal: { type: 'system', id: null, name },
    user: null,
    sessionId: null,
    permissions,
    can: (permission, resource) => permissions.can(permission, resource),
    require(permission, resource) {
      if (!permissions.can(permission, resource)) throw httpErrors.forbidden();
    },
    reach: (permission) => permissions.reach(permission),
  };
}

/** A connection by name (case-insensitive), for idempotent seeds. */
export async function connectionByName(ctx: ModuleContext, name: string): Promise<ConnectionOut | null> {
  const [row] = await ctx.db
    .select({ id: connections.id })
    .from(connections)
    .where(sql`lower(${connections.name}) = ${name.toLowerCase()}`);
  return row ? services(ctx).connections.get(row.id) : null;
}

/** Creates a connection (settings validated by the connector, secrets sealed). Returns the webhook secret once. */
export async function createConnection(
  ctx: ModuleContext,
  input: CreateConnectionInput,
  auth: AuthContext = hubAuth(),
): Promise<{ connection: ConnectionOut; webhookSecret: string }> {
  const parsed = createConnectionSchema.parse(input);
  const { webhookSecret, ...connection } = await services(ctx).connections.create(parsed, auth);
  return { connection, webhookSecret };
}

/**
 * Creates a sync profile. `mappings: 'default'` (or leaving them out) uses the connector's suggested mapping
 * for the object ↔ entity pair.
 */
export async function createProfile(
  ctx: ModuleContext,
  input: Omit<CreateProfileInput, 'mappings'> & { mappings?: FieldMapping[] | 'default' },
  auth: AuthContext = hubAuth(),
): Promise<ProfileOut> {
  const s = services(ctx);
  let mappings = input.mappings;
  if (!mappings || mappings === 'default')
    mappings = (
      await s.profiles.defaultMapping({
        connectionId: input.connectionId,
        objectType: input.objectType,
        entity: input.entity,
        scope: input.remoteScope ?? undefined,
        containerId: input.containerId ?? undefined,
      })
    ).mappings;
  return s.profiles.create(createProfileSchema.parse({ ...input, mappings }), auth);
}

/** Runs a profile's pull (an export for push-only profiles) to the end and returns the finished run. */
export async function runPullNow(
  ctx: ModuleContext,
  profileId: string,
  trigger: 'manual' | 'schedule' = 'manual',
): Promise<RunDetailOut> {
  const run = await services(ctx).engine.runNow(profileId, trigger);
  return services(ctx).runs.detail(run.id);
}

/**
 * Sets a connection's webhook secret to a known value (generated when omitted), so a stand-in server can call
 * `POST /api/v1/integrations/hooks/:connectionId`. Returns the path and the secret. Audited.
 */
export async function registerDemoWebhook(
  ctx: ModuleContext,
  connectionId: string,
  secret?: string,
): Promise<{ path: string; secret: string }> {
  const value = secret ?? newWebhookSecret().secret;
  await ctx.transaction(async (tx) => {
    const [row] = await tx
      .update(connections)
      .set({
        webhookSecretHash: createHash('sha256').update(value, 'utf8').digest('hex'),
        webhookRotatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId))
      .returning();
    if (!row) throw httpErrors.notFound('Connection not found');
    await ctx.audit.record(
      {
        action: 'integrations.connection.secret_rotated',
        entityType: 'integrations.connection',
        entityId: row.id,
        entityLabel: row.name,
        category: 'security',
        metadata: { source: 'seed' },
      },
      { tx },
    );
  });
  return { path: webhookPath(connectionId), secret: value };
}
