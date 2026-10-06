import { BlockList, isIP } from 'node:net';
import { apiClientSecrets, apiClients } from '@isbp/db/schema';
import { type Db, type Grant, PermissionSet } from '@isbp/sdk/server';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { randomToken, sha256Hex } from './crypto';

export const API_KEY_PREFIX = 'isbp_sk_';
export const ACCESS_TOKEN_PREFIX = 'isbp_at_';
export const ROLE_QUERY_PERMISSION = 'core.role-query.read';
export const OAUTH_SCOPES = ['role-query', 'api'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export type ApiClientRow = typeof apiClients.$inferSelect;

const tokenKey = (hash: string) => `isbp:oauth:at:${hash}`;
const clientTokensKey = (id: string) => `isbp:oauth:client:${id}`;

/** A new API key / client secret: shown once, stored as SHA-256. */
export function generateSecret() {
  const secret = `${API_KEY_PREFIX}${randomToken(32)}`;
  return { secret, prefix: secret.slice(0, API_KEY_PREFIX.length + 6), hash: sha256Hex(secret) };
}

export function generateClientId() {
  return `cli_${randomToken(9).replace(/[-_]/g, 'x').toLowerCase()}`;
}

/**
 * What a client may do: Role Query on its applications (record-scoped `application:<id>` grants, or
 * global for "all applications") plus any explicit platform API permissions.
 */
export function clientGrants(
  client: Pick<ApiClientRow, 'permissions' | 'applicationIds' | 'allApplications'>,
  scopes?: readonly OAuthScope[],
): Grant[] {
  const wants = (s: OAuthScope) => !scopes || scopes.includes(s);
  const grants: Grant[] = [];
  if (wants('role-query')) {
    if (client.allApplications) grants.push({ p: ROLE_QUERY_PERMISSION, s: 'g' });
    else
      for (const id of client.applicationIds)
        grants.push({ p: ROLE_QUERY_PERMISSION, s: 'r', t: 'application', id });
  }
  if (wants('api')) for (const p of client.permissions) grants.push({ p, s: 'g' });
  return grants;
}

export function ipAllowed(cidrs: readonly string[], ip: string): boolean {
  if (!cidrs.length) return true;
  const list = new BlockList();
  for (const c of cidrs) {
    const [net, bits] = c.split('/');
    const family = isIP(net ?? '');
    if (!family) continue;
    const prefix = bits === undefined ? (family === 6 ? 128 : 32) : Number(bits);
    list.addSubnet(net!, prefix, family === 6 ? 'ipv6' : 'ipv4');
  }
  const family = isIP(ip.replace(/^::ffff:/, ''));
  if (!family) return false;
  return list.check(ip.replace(/^::ffff:/, ''), family === 6 ? 'ipv6' : 'ipv4');
}

export interface AuthenticatedClient {
  client: ApiClientRow;
  permissions: PermissionSet;
  via: 'api_key' | 'oauth';
}

/** Verifies API keys and OAuth access tokens; issues client-credentials tokens. */
export class ApiClientAuth {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly tokenTtlSeconds: number,
  ) {}

  private async touch(client: ApiClientRow, ip: string, secretId?: string) {
    const now = new Date();
    if (client.lastUsedAt && now.getTime() - client.lastUsedAt.getTime() < 60_000) return;
    await this.db
      .update(apiClients)
      .set({ lastUsedAt: now, lastUsedIp: ip })
      .where(eq(apiClients.id, client.id));
    if (secretId)
      await this.db
        .update(apiClientSecrets)
        .set({ lastUsedAt: now })
        .where(eq(apiClientSecrets.id, secretId));
  }

  private async bySecret(secret: string) {
    const [row] = await this.db
      .select({ client: apiClients, secretId: apiClientSecrets.id })
      .from(apiClientSecrets)
      .innerJoin(apiClients, eq(apiClients.id, apiClientSecrets.apiClientId))
      .where(
        and(
          eq(apiClientSecrets.secretHash, sha256Hex(secret)),
          isNull(apiClientSecrets.revokedAt),
          or(isNull(apiClientSecrets.expiresAt), gt(apiClientSecrets.expiresAt, new Date())),
          isNull(apiClients.revokedAt),
        ),
      );
    return row ?? null;
  }

  /** `Authorization: Bearer isbp_sk_…` (API key) or `Bearer isbp_at_…` (OAuth access token). */
  async authenticate(token: string, ip: string): Promise<AuthenticatedClient | null> {
    if (token.startsWith(API_KEY_PREFIX)) {
      const row = await this.bySecret(token);
      if (!row || !ipAllowed(row.client.allowedCidrs, ip)) return null;
      await this.touch(row.client, ip, row.secretId);
      return { client: row.client, permissions: new PermissionSet(clientGrants(row.client)), via: 'api_key' };
    }
    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const raw = await this.redis.get(tokenKey(sha256Hex(token)));
      if (!raw) return null;
      const { id, scopes } = JSON.parse(raw) as { id: string; scopes: OAuthScope[] };
      const [client] = await this.db
        .select()
        .from(apiClients)
        .where(and(eq(apiClients.id, id), isNull(apiClients.revokedAt)));
      if (!client || !ipAllowed(client.allowedCidrs, ip)) return null;
      await this.touch(client, ip);
      return { client, permissions: new PermissionSet(clientGrants(client, scopes)), via: 'oauth' };
    }
    return null;
  }

  /** RFC 6749 §4.4 client credentials grant. Any credential problem is `invalid_client`. */
  async issueToken(
    clientId: string,
    secret: string,
    requested: string | undefined,
    ip: string,
  ): Promise<
    | { ok: true; client: ApiClientRow; token: string; scopes: OAuthScope[]; expiresIn: number }
    | { ok: false; error: 'invalid_client' | 'invalid_scope' }
  > {
    const row = await this.bySecret(secret);
    if (!row || row.client.clientId !== clientId || !ipAllowed(row.client.allowedCidrs, ip))
      return { ok: false, error: 'invalid_client' };
    const asked = requested?.split(/\s+/).filter(Boolean) ?? [];
    const scopes = (asked.length ? asked : OAUTH_SCOPES).filter((s): s is OAuthScope =>
      (OAUTH_SCOPES as readonly string[]).includes(s),
    );
    if (asked.length && !scopes.length) return { ok: false, error: 'invalid_scope' };
    const token = `${ACCESS_TOKEN_PREFIX}${randomToken(32)}`;
    const hash = sha256Hex(token);
    await this.redis
      .multi()
      .set(tokenKey(hash), JSON.stringify({ id: row.client.id, scopes }), 'EX', this.tokenTtlSeconds)
      .sadd(clientTokensKey(row.client.id), hash)
      .expire(clientTokensKey(row.client.id), this.tokenTtlSeconds)
      .exec();
    await this.touch(row.client, ip, row.secretId);
    return { ok: true, client: row.client, token, scopes, expiresIn: this.tokenTtlSeconds };
  }

  /** Invalidates every outstanding access token of a client (revocation, permission changes). */
  async revokeTokens(clientRowId: string) {
    const hashes = await this.redis.smembers(clientTokensKey(clientRowId));
    if (hashes.length) await this.redis.del(...hashes.map(tokenKey));
    await this.redis.del(clientTokensKey(clientRowId));
  }
}
