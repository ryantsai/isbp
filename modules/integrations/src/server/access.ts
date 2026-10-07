/**
 * Who may do what in the Integrations Hub (routes, the task type and the record panel use these):
 *
 * - `integrations.connections.read` sees connections (never their secrets), profiles, runs, links and
 *   conflicts. Local record titles are resolved through `ctx.records` for the caller, so records they can't
 *   see stay hidden.
 * - `integrations.connections.manage` adds, edits and tests connections, rotates webhook secrets, runs
 *   syncs and manages links. Creating or changing a profile also needs the synced entity's `.sync`
 *   permission (no privilege escalation through the hub's agent).
 * - `integrations.conflicts.resolve` picks a side for conflicting fields (on records the caller can see).
 * - The record panel ("Synced with") is visible to whoever can read the record.
 */
import { type AuthContext, ErrorCodes, HttpError, type SyncEntityInfo } from '@isbp/sdk/server';

export const READ = 'integrations.connections.read';
export const MANAGE = 'integrations.connections.manage';
export const RESOLVE = 'integrations.conflicts.resolve';

/** Holds the permission at any scope. */
export function reaches(auth: AuthContext, permission: string): boolean {
  const r = auth.reach(permission);
  return r.global || r.departmentIds.length > 0 || r.records.length > 0;
}

/** May set up (or change) a profile that writes this entity: needs its `.sync` permission. */
export function canConfigure(auth: AuthContext, entity: Pick<SyncEntityInfo, 'permission'>): boolean {
  return auth.can(MANAGE) && auth.can(entity.permission);
}

export function requireConfigure(auth: AuthContext, entity: Pick<SyncEntityInfo, 'entity' | 'permission'>) {
  auth.require(MANAGE);
  if (!auth.can(entity.permission)) {
    // `require` audits the denial.
    try {
      auth.require(entity.permission);
    } catch {
      throw new HttpError(
        403,
        ErrorCodes.FORBIDDEN,
        `Setting up a sync of ${entity.entity} needs ${entity.permission}`,
        { permission: entity.permission },
      );
    }
  }
}

/** The person behind a principal (for `created_by`, `resolved_by`). */
export const personOf = (auth: AuthContext): string | null => auth.user?.id ?? null;
