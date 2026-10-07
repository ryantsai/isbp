import { createHash } from 'node:crypto';
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type DbConnectionInfo,
  ErrorCodes,
  HttpError,
  type ModuleContext,
} from '@isbp/sdk/server';
import { inArray } from 'drizzle-orm';
import type { ConnectionRef } from '../contracts';
import { canonicalJson, type EndpointDefinition } from '../model';

export const ENDPOINTS_READ = 'etl.endpoints.read';
export const ENDPOINTS_MANAGE = 'etl.endpoints.manage';
export const ENDPOINTS_INVOKE = 'etl.endpoints.invoke';
export const PIPELINES_READ = 'etl.pipelines.read';
export const PIPELINES_MANAGE = 'etl.pipelines.manage';
export const PIPELINES_RUN = 'etl.pipelines.run';

export const ENDPOINT_TYPE = 'etl.endpoint';
export const PIPELINE_TYPE = 'etl.pipeline';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** People may call an endpoint with `etl.endpoints.invoke` globally or on that endpoint. */
export const mayInvoke = (auth: AuthContext, endpointId: string) =>
  auth.can(ENDPOINTS_INVOKE, { recordType: ENDPOINT_TYPE, recordId: endpointId });

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Stable hash of what a version would freeze (publishing needs a test of exactly this). */
export const definitionHash = (def: EndpointDefinition) => sha256(canonicalJson(def));

/** 400 VALIDATION_FAILED with field issues (paths match the request body). */
export function invalid(issues: { path: string; message: string }[], message = 'Some fields are invalid') {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues });
}

/** Every connection the kernel knows, by id (small table; read once per request). */
export async function connectionMap(ctx: ModuleContext): Promise<Map<string, DbConnectionInfo>> {
  return new Map((await ctx.databases.list()).map((c) => [c.id, c]));
}

export function connectionRef(id: string, map: Map<string, DbConnectionInfo>): ConnectionRef {
  const c = map.get(id);
  if (!c) return { id, name: id.slice(0, 8), engine: null, readOnly: false, status: 'missing' };
  return { id, name: c.name, engine: c.engine, readOnly: c.readOnly, status: c.status };
}

/** A connection a module may use for `data`: it exists, allows `data` and is enabled (400/403/409). */
export async function dataConnection(
  ctx: ModuleContext,
  id: string,
  path: string,
): Promise<DbConnectionInfo> {
  const c = await ctx.databases.get(id);
  if (!c) throw invalid([{ path, message: 'Unknown database connection' }]);
  if (!c.purposes.includes('data'))
    throw new HttpError(403, ErrorCodes.CONNECTION_PURPOSE, `Connection ${c.name} is not for data use`, {
      purpose: 'data',
      path,
    });
  return c;
}

/** Display names of people (audit-free lookups for DTOs). */
export async function peopleById(ctx: ModuleContext, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map<string, { id: string; displayName: string; avatarUrl: string | null }>();
  const rows = await ctx.db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The caller as audit/log rows name it. */
export function principalOf(auth: AuthContext) {
  if (auth.client) return { type: 'client' as const, id: auth.client.id, name: auth.client.name };
  return {
    type: 'user' as const,
    id: auth.user?.id ?? auth.principal.id ?? null,
    name: auth.user?.displayName ?? auth.principal.name,
  };
}
