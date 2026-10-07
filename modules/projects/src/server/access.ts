/**
 * Who may see and do what in a project. Routes, record resolvers, global search and AI tools all go
 * through these functions, so the UI and the API can never disagree.
 *
 * - `projects.projects.admin` manages every project; `projects.portfolio.read` sees every project.
 * - With `projects.projects.use`, people see internal projects and the private ones they belong to.
 * - Inside a project, managers edit the project, its members, milestones and any task; members create and
 *   edit tasks and comment; viewers read and comment. Non-members of an internal project only read.
 * - Archived projects are read-only (managers can still unarchive them).
 */
import type { AuthContext } from '@isbp/sdk/server';
import { and, eq, or, type SQL, sql } from 'drizzle-orm';
import {
  type MemberRole,
  PERMISSIONS,
  projectTransitions,
  type ProjectStatus,
  type Visibility,
} from '../model';
import { members, projects } from './schema';

export interface ProjectAccess {
  role: MemberRole | null;
  canView: boolean;
  canManage: boolean;
  canEditTasks: boolean;
  canComment: boolean;
  canDelete: boolean;
}

export const isAdmin = (auth: AuthContext) => auth.can(PERMISSIONS.admin);
/** Sees every project, private ones included. */
export const seesAll = (auth: AuthContext) => isAdmin(auth) || auth.can(PERMISSIONS.portfolio);
export const canUse = (auth: AuthContext) => auth.can(PERMISSIONS.use) || seesAll(auth);

export function accessFor(
  project: { visibility: Visibility; archivedAt: Date | null; status?: ProjectStatus },
  role: MemberRole | null,
  auth: AuthContext,
  opts: { hasTasks?: boolean } = {},
): ProjectAccess {
  const admin = isAdmin(auth);
  const use = canUse(auth);
  const canView = seesAll(auth) || (use && (project.visibility === 'internal' || role !== null));
  if (!canView)
    return {
      role: null,
      canView: false,
      canManage: false,
      canEditTasks: false,
      canComment: false,
      canDelete: false,
    };
  const live = !project.archivedAt;
  const canManage = admin || (use && role === 'manager');
  const canEditTasks = live && (canManage || (use && role === 'member'));
  const canComment = live && (canEditTasks || (use && role === 'viewer'));
  return {
    role,
    canView,
    canManage,
    canEditTasks,
    canComment,
    canDelete: admin || (canManage && opts.hasTasks === false),
  };
}

/** Statuses the caller may move the project to right now. */
export function transitionsFor(status: ProjectStatus, access: ProjectAccess): ProjectStatus[] {
  return access.canManage ? [...projectTransitions(status)] : [];
}

/** SQL filter: projects the caller may see (none without `projects.projects.use`). */
export function visibleProjects(auth: AuthContext): SQL | undefined {
  if (seesAll(auth)) return undefined;
  if (!canUse(auth)) return sql`false`;
  const me = auth.user?.id;
  if (!me) return eq(projects.visibility, 'internal');
  return or(
    eq(projects.visibility, 'internal'),
    sql`exists (select 1 from ${members} where ${members.projectId} = ${projects.id} and ${members.userId} = ${me})`,
  );
}

/** SQL filter: projects the caller belongs to (any role). */
export function memberOf(userId: string): SQL {
  return sql`exists (select 1 from ${members} where ${members.projectId} = ${projects.id} and ${members.userId} = ${userId})`;
}

/** The caller's membership role in a project, as a correlated subquery. */
export function myRoleColumn(auth: AuthContext) {
  const me = auth.user?.id;
  return me
    ? sql<MemberRole | null>`(select ${members.role} from ${members} where ${members.projectId} = ${projects.id} and ${members.userId} = ${me})`
    : sql<MemberRole | null>`null::varchar`;
}

export const roleWhere = (projectId: string, userId: string) =>
  and(eq(members.projectId, projectId), eq(members.userId, userId));
