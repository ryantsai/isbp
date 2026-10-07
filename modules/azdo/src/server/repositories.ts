import { createHash } from 'node:crypto';
import type { RemoteChangesPage, RemoteRecord } from '@isbp/sdk/server';
import { type AzdoConn, azdo, seg } from './client';
import { isGuid, type ListOf, resolveProject } from './shared';

interface AzdoRepository {
  id: string;
  name: string;
  /** From 7.2-preview (Azure DevOps Server, 2025+). */
  creationDate?: string;
  defaultBranch?: string;
  webUrl?: string;
  remoteUrl?: string;
  isDisabled?: boolean;
  project?: { id: string; name: string };
}

interface AzdoRef {
  name: string;
  objectId: string;
}

interface GitUserDate {
  name?: string;
  email?: string;
  date?: string;
}

interface AzdoCommit {
  commitId: string;
  author?: GitUserDate;
  committer?: GitUserDate;
  comment?: string;
}

interface AzdoBranchStats {
  name: string;
  aheadCount?: number;
  behindCount?: number;
  isBaseVersion?: boolean;
  commit?: AzdoCommit;
}

interface AzdoPullRequest {
  pullRequestId: number;
  title?: string;
  status?: string;
  isDraft?: boolean;
  createdBy?: { displayName?: string; uniqueName?: string };
  creationDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: { commitId?: string };
}

/** A branch, in the shape of ALM's `repoBranchSchema` (the default branch first, without ahead/behind). */
export interface BranchValue {
  name: string;
  commitSha: string;
  committedAt?: string;
  ahead?: number;
  behind?: number;
}

/** An active pull request, in the shape of ALM's `repoPullRequestSchema`. */
export interface PullRequestValue {
  id: string;
  title: string;
  author: string | null;
  sourceBranch: string;
  targetBranch: string;
  url: string | null;
  createdAt: string | null;
  draft: boolean;
}

/** Branches and pull requests kept per repository value (the newest first). */
export const MAX_BRANCHES = 20;
export const MAX_PULL_REQUESTS = 20;
const VALUES_TTL = 24 * 3600;

const branchName = (ref: string | undefined) => (ref ?? '').replace(/^refs\/heads\//, '');
const iso = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

async function listRepositories(conn: AzdoConn, projectId: string): Promise<AzdoRepository[]> {
  const res = await azdo<ListOf<AzdoRepository>>(conn, `${seg(projectId)}/_apis/git/repositories`);
  return (res.body?.value ?? []).filter((r) => !r.isDisabled).sort((a, b) => a.name.localeCompare(b.name));
}

async function listHeads(conn: AzdoConn, projectId: string, repoId: string): Promise<AzdoRef[]> {
  const all: AzdoRef[] = [];
  let token: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await azdo<ListOf<AzdoRef>>(
      conn,
      `${seg(projectId)}/_apis/git/repositories/${seg(repoId)}/refs`,
      {
        query: { filter: 'heads/', $top: 1000, continuationToken: token },
      },
    );
    all.push(...(res.body?.value ?? []));
    token = res.headers['x-ms-continuationtoken'];
    if (!token) break;
  }
  return all;
}

async function activePullRequests(
  conn: AzdoConn,
  projectId: string,
  repoId: string,
): Promise<AzdoPullRequest[]> {
  const res = await azdo<ListOf<AzdoPullRequest>>(
    conn,
    `${seg(projectId)}/_apis/git/repositories/${seg(repoId)}/pullrequests`,
    { query: { 'searchCriteria.status': 'active', $top: 100 } },
  );
  return res.body?.value ?? [];
}

/**
 * What decides whether a repository changed: default branch, every branch head and every active pull
 * request. Same inputs, same version, so the hub skips repositories nobody touched.
 */
export function repositoryVersion(repo: AzdoRepository, heads: AzdoRef[], prs: AzdoPullRequest[]): string {
  const fingerprint = {
    name: repo.name,
    url: repo.webUrl ?? null,
    defaultBranch: repo.defaultBranch ?? null,
    heads: heads.map((h) => [h.name, h.objectId]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0)),
    prs: prs
      .map((p) => [
        p.pullRequestId,
        p.status ?? '',
        p.title ?? '',
        p.isDraft ?? false,
        p.sourceRefName ?? '',
        p.targetRefName ?? '',
        p.lastMergeSourceCommit?.commitId ?? '',
      ])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  };
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 32);
}

async function repositoryValues(
  conn: AzdoConn,
  projectId: string,
  repo: AzdoRepository,
  heads: AzdoRef[],
  prs: AzdoPullRequest[],
): Promise<Record<string, unknown>> {
  const base = `${seg(projectId)}/_apis/git/repositories/${seg(repo.id)}`;
  const defaultBranch = repo.defaultBranch ? branchName(repo.defaultBranch) : null;
  const hasDefault = Boolean(defaultBranch && heads.some((h) => h.name === repo.defaultBranch));
  let last: AzdoCommit | null = null;
  let stats: AzdoBranchStats[] = [];
  if (hasDefault) {
    const commits = await azdo<ListOf<AzdoCommit>>(conn, `${base}/commits`, {
      query: {
        'searchCriteria.itemVersion.version': defaultBranch!,
        'searchCriteria.itemVersion.versionType': 'branch',
        'searchCriteria.$top': 1,
      },
    });
    last = commits.body?.value?.[0] ?? null;
    const s = await azdo<ListOf<AzdoBranchStats>>(conn, `${base}/stats/branches`, {
      query: {
        'baseVersionDescriptor.version': defaultBranch!,
        'baseVersionDescriptor.versionType': 'branch',
      },
      allow: [404],
    });
    stats = s.status === 404 ? [] : (s.body?.value ?? []);
  }
  const statsByName = new Map(stats.map((s) => [s.name, s]));
  const committed = (name: string) => {
    const c = statsByName.get(name)?.commit;
    return iso(c?.committer?.date ?? c?.author?.date);
  };
  const dateOf = (name: string) => Date.parse(committed(name) ?? '') || 0;
  const branches: BranchValue[] = heads
    .map((h) => {
      const name = branchName(h.name);
      const s = statsByName.get(name);
      const b: BranchValue = { name, commitSha: h.objectId };
      const at = committed(name);
      if (at) b.committedAt = at;
      if (s && !s.isBaseVersion && name !== defaultBranch) {
        b.ahead = s.aheadCount ?? 0;
        b.behind = s.behindCount ?? 0;
      }
      return b;
    })
    .sort((a, b) =>
      a.name === defaultBranch
        ? -1
        : b.name === defaultBranch
          ? 1
          : dateOf(b.name) - dateOf(a.name) || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_BRANCHES);
  const pullRequests: PullRequestValue[] = prs
    .map((p) => ({
      id: String(p.pullRequestId),
      title: p.title?.trim() || `#${p.pullRequestId}`,
      author: p.createdBy?.displayName ?? p.createdBy?.uniqueName ?? null,
      sourceBranch: branchName(p.sourceRefName),
      targetBranch: branchName(p.targetRefName),
      url: repo.webUrl ? `${repo.webUrl}/pullrequest/${p.pullRequestId}` : null,
      createdAt: iso(p.creationDate),
      draft: Boolean(p.isDraft),
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || Number(b.id) - Number(a.id))
    .slice(0, MAX_PULL_REQUESTS);
  const message = last?.comment?.trim() ?? null;
  return {
    name: repo.name,
    url: repo.webUrl ?? null,
    provider: 'azure_devops',
    defaultBranch,
    lastCommitSha: last?.commitId ?? null,
    lastCommitAt: iso(last?.author?.date ?? last?.committer?.date),
    lastCommitMessage: message ? message.slice(0, 500) : null,
    lastCommitAuthor: last?.author?.name ?? last?.committer?.name ?? null,
    branches,
    pullRequests,
  };
}

async function toRecord(conn: AzdoConn, projectId: string, repo: AzdoRepository): Promise<RemoteRecord> {
  const [heads, prs] = await Promise.all([
    listHeads(conn, projectId, repo.id),
    activePullRequests(conn, projectId, repo.id),
  ]);
  const version = repositoryVersion(repo, heads, prs);
  const key = `repo:${repo.id.toLowerCase()}`;
  const cached = await conn.cache.get<{ version: string; values: Record<string, unknown> }>(key);
  let values = cached?.version === version ? cached.values : null;
  if (!values) {
    values = await repositoryValues(conn, projectId, repo, heads, prs);
    await conn.cache.set(key, { version, values }, VALUES_TTL);
  }
  const dates = [
    values.lastCommitAt as string | null,
    ...(values.pullRequests as PullRequestValue[]).map((p) => p.createdAt),
  ].filter((d): d is string => Boolean(d));
  return {
    id: repo.id.toLowerCase(),
    ref: repo.name,
    title: repo.name,
    url: repo.webUrl ?? null,
    version,
    updatedAt: dates.sort().at(-1) ?? iso(repo.creationDate) ?? new Date().toISOString(),
    scope: projectId,
    values,
  };
}

/**
 * Repositories have no change feed: each run lists the project's repositories (by name, paged by an offset
 * cursor) and the hub skips those whose version didn't change. The last page returns a null cursor, so the
 * next run starts over.
 */
export async function repositoryChanges(
  conn: AzdoConn,
  opts: { scope?: string | null; cursor: string | null; limit: number },
): Promise<RemoteChangesPage> {
  const projectId = await resolveProject(conn, opts.scope);
  const repos = await listRepositories(conn, projectId);
  const offset = /^offset:\d+$/.test(opts.cursor ?? '') ? Number(opts.cursor!.slice(7)) : 0;
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit) || 50));
  const page = repos.slice(offset, offset + limit);
  const items: RemoteRecord[] = [];
  for (const repo of page) items.push(await toRecord(conn, projectId, repo));
  const end = offset + page.length;
  const hasMore = end < repos.length;
  return { items, cursor: hasMore ? `offset:${end}` : null, hasMore };
}

export async function getRepository(
  conn: AzdoConn,
  id: string,
  scope?: string | null,
): Promise<RemoteRecord | null> {
  if (!isGuid(id) && !/^[\w.-]{1,64}$/.test(id)) return null;
  const projectId = scope ? await resolveProject(conn, scope) : null;
  const path = projectId
    ? `${seg(projectId)}/_apis/git/repositories/${seg(id)}`
    : `_apis/git/repositories/${seg(id)}`;
  const res = await azdo<AzdoRepository>(conn, path, { allow: [404] });
  if (res.status === 404 || !res.body?.id) return null;
  const repo = res.body;
  const owner = repo.project?.id?.toLowerCase() ?? projectId;
  if (!owner) return null;
  if (repo.isDisabled)
    // A disabled repository can't be read any further: report it gone, as the hub does for deletes.
    return {
      id: repo.id.toLowerCase(),
      ref: repo.name,
      title: repo.name,
      url: repo.webUrl ?? null,
      version: 'disabled',
      updatedAt: new Date().toISOString(),
      scope: owner,
      deleted: true,
      values: { name: repo.name, url: repo.webUrl ?? null, provider: 'azure_devops' },
    };
  const record = await toRecord(conn, owner, repo);
  if (projectId && owner !== projectId) record.deleted = true;
  return record;
}
