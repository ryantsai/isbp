import { users } from '@isbp/db/schema';
import { type AuthContext, type Db, ErrorCodes, HttpError } from '@isbp/sdk/server';
import { inArray } from 'drizzle-orm';
import { formatTaskRef } from '../model';

export const PROJECT_ENTITY = 'projects.project';
export const TASK_ENTITY = 'projects.task';

export const projectHref = (key: string) => `/projects/${key}`;
export const taskHref = (reference: string) => `/projects/tasks/${reference}`;

/** 400 `VALIDATION_FAILED` for one field (the UI maps `issues[].path` onto the form). */
export function invalid(path: string, message: string, details: Record<string, unknown> = {}): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, {
    issues: [{ path, message }],
    ...details,
  });
}

export function notFound(what: 'project' | 'task' | 'milestone' | 'member' | 'comment'): HttpError {
  const label = {
    project: 'Project',
    task: 'Task',
    milestone: 'Milestone',
    member: 'Member',
    comment: 'Comment',
  }[what];
  return new HttpError(404, ErrorCodes.NOT_FOUND, `${label} not found`);
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, ErrorCodes.FORBIDDEN, message);
}

/** Postgres error code of a (possibly wrapped) driver error. */
export function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** The person behind a request (null for API clients and the system). */
export const actorOf = (auth: AuthContext): string | null => auth.user?.id ?? null;

export interface PersonInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string;
  jobTitle: string | null;
  status: string;
}

export const personRef = (p: PersonInfo | null | undefined) =>
  p ? { id: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl } : null;

/** People by id in one query (ids may repeat or be null). */
export async function peopleByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonInfo>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      email: users.email,
      jobTitle: users.jobTitle,
      status: users.status,
    })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

export const taskReference = (projectKey: string, number: number) => formatTaskRef(projectKey, number);

/** `NET-12 Replace core switch` — the label audit rows show. */
export const taskAuditLabel = (projectKey: string, t: { number: number; title: string }) =>
  `${formatTaskRef(projectKey, t.number)} ${t.title}`;

export const projectAuditLabel = (p: { key: string; name: string }) => `${p.key} ${p.name}`;

/** Numbers come back from `numeric` columns as numbers already; keep two decimals for hours. */
export const hoursOrNull = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Math.round(n * 100) / 100;
