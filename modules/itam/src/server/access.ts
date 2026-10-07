/**
 * Who may see and change what. The routes, the AI tools, the record resolvers, global search and the
 * `viewer` block of the DTOs all use these functions, so the UI and the API can never disagree.
 *
 * - Hardware is read with `itam.hardware.read`, globally or for a department: the assets of that
 *   department **or** assigned to people in it.
 * - Everyone with `itam.self.read` sees the assets assigned to them (My devices), and the record
 *   resolver returns them too (read-only), so an incident can be linked to "my laptop".
 * - Software and contracts are global permissions (`itam.software.read`, `itam.contracts.read`).
 * - Changes need the matching `*.manage` permission (global).
 */
import { users } from '@isbp/db/schema';
import type { AuthContext } from '@isbp/sdk/server';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { assets } from './schema';

export const HARDWARE_READ = 'itam.hardware.read';
export const HARDWARE_MANAGE = 'itam.hardware.manage';
export const SOFTWARE_READ = 'itam.software.read';
export const SOFTWARE_MANAGE = 'itam.software.manage';
export const LICENSES_REVEAL = 'itam.licenses.reveal';
export const CONTRACTS_READ = 'itam.contracts.read';
export const CONTRACTS_MANAGE = 'itam.contracts.manage';
export const SELF_READ = 'itam.self.read';
export const CONFIG_MANAGE = 'itam.config.manage';

/** Departments that make an asset visible: its own, and its assignee's. */
export interface AssetScope {
  departmentId: string | null;
  assigneeDepartmentId: string | null;
  assignedTo: string | null;
}

export function canReadHardware(auth: AuthContext, a: AssetScope): boolean {
  return (
    auth.can(HARDWARE_READ, { departmentId: a.departmentId }) ||
    (a.assigneeDepartmentId !== null && auth.can(HARDWARE_READ, { departmentId: a.assigneeDepartmentId }))
  );
}

/** The caller's own device (My devices). */
export function isOwnAsset(auth: AuthContext, a: { assignedTo: string | null }): boolean {
  const me = auth.user?.id;
  return Boolean(me && a.assignedTo === me && auth.permissions.hasAny(SELF_READ));
}

/**
 * SQL filter for assets the caller may list as a hardware reader (undefined = everything). Department
 * readers see their departments' assets and those assigned to people in them.
 */
export function hardwareFilter(auth: AuthContext): SQL | undefined {
  const reach = auth.reach(HARDWARE_READ);
  if (reach.global) return undefined;
  if (!reach.departmentIds.length) return sql`false`;
  return or(
    inArray(assets.departmentId, reach.departmentIds),
    inArray(
      assets.assignedTo,
      sql`(select ${users.id} from ${users} where ${inArray(users.departmentId, reach.departmentIds)})`,
    ),
  );
}

/** Hardware readers' reach plus the caller's own devices (record resolvers, the person page). */
export function visibleAssetsFilter(auth: AuthContext): SQL {
  const read = auth.permissions.hasAny(HARDWARE_READ) ? (hardwareFilter(auth) ?? sql`true`) : sql`false`;
  const me = auth.user?.id;
  return me && auth.permissions.hasAny(SELF_READ) ? or(read, eq(assets.assignedTo, me))! : read;
}

export const canManageHardware = (auth: AuthContext) => auth.can(HARDWARE_MANAGE);
export const canReadSoftware = (auth: AuthContext) => auth.can(SOFTWARE_READ);
export const canManageSoftware = (auth: AuthContext) => auth.can(SOFTWARE_MANAGE);
export const canReadContracts = (auth: AuthContext) => auth.can(CONTRACTS_READ);
export const canManageContracts = (auth: AuthContext) => auth.can(CONTRACTS_MANAGE);

/** Combines optional conditions. */
export const all = (...parts: (SQL | undefined)[]) => and(...parts.filter((p): p is SQL => Boolean(p)));
