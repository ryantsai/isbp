import type { AdoCommitState, AdoRepoState, AdoState } from './state';
import type { Urls } from './work-items';

/** Every commit reachable from `sha` (inclusive). */
export function reachable(repo: AdoRepoState, sha: string | undefined): Set<string> {
  const seen = new Set<string>();
  const stack = sha ? [sha] : [];
  while (stack.length) {
    const s = stack.pop()!;
    if (seen.has(s) || !repo.commits[s]) continue;
    seen.add(s);
    stack.push(...repo.commits[s]!.parents);
  }
  return seen;
}

/** History from a commit, newest first (by committer date, then topology). */
export function history(repo: AdoRepoState, sha: string | undefined): AdoCommitState[] {
  return [...reachable(repo, sha)]
    .map((s) => repo.commits[s]!)
    .sort((a, b) => b.committer.date.localeCompare(a.committer.date) || (a.parents.includes(b.sha) ? -1 : 1));
}

/** Commits on `branch` not on `base`, and the reverse. */
export function aheadBehind(repo: AdoRepoState, branch: string, base: string) {
  const a = reachable(repo, repo.refs[branch]);
  const b = reachable(repo, repo.refs[base]);
  return {
    ahead: [...a].filter((s) => !b.has(s)).length,
    behind: [...b].filter((s) => !a.has(s)).length,
  };
}

export const repoApiUrl = (urls: Urls, repo: AdoRepoState) =>
  `${urls.api}/${repo.projectId}/_apis/git/repositories/${repo.id}`;

export function repoWebUrl(state: AdoState, urls: Urls, repo: AdoRepoState) {
  const project = state.projects.find((p) => p.id === repo.projectId)!;
  return `${urls.web}/${encodeURIComponent(project.name)}/_git/${encodeURIComponent(repo.name)}`;
}

export function serializeProject(urls: Urls, p: AdoState['projects'][number]) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    url: `${urls.api}/_apis/projects/${p.id}`,
    state: 'wellFormed',
    revision: p.revision,
    visibility: p.visibility,
    lastUpdateTime: p.lastUpdateTime,
  };
}

export function serializeRepo(state: AdoState, urls: Urls, repo: AdoRepoState) {
  const project = state.projects.find((p) => p.id === repo.projectId)!;
  const web = repoWebUrl(state, urls, repo);
  return {
    id: repo.id,
    name: repo.name,
    url: repoApiUrl(urls, repo),
    project: serializeProject(urls, project),
    defaultBranch: repo.defaultBranch,
    size: Object.keys(repo.commits).length * 48_213,
    remoteUrl: web,
    sshUrl: `ssh://${new URL(urls.web).host}:22/${encodeURIComponent(project.name)}/_git/${encodeURIComponent(repo.name)}`,
    webUrl: web,
    isDisabled: repo.isDisabled,
    isInMaintenance: false,
    // Returned from 7.2-preview on; the earliest commit stands in for the creation date.
    creationDate: Object.values(repo.commits)
      .map((c) => c.author.date)
      .sort()[0],
  };
}

export function serializeCommit(urls: Urls, repo: AdoRepoState, c: AdoCommitState, web: string) {
  return {
    commitId: c.sha,
    author: c.author,
    committer: c.committer,
    comment: c.message.length > 100 ? `${c.message.slice(0, 100)}` : c.message,
    ...(c.message.length > 100 ? { commentTruncated: true } : {}),
    changeCounts: { Add: 0, Edit: 1, Delete: 0 },
    url: `${repoApiUrl(urls, repo)}/commits/${c.sha}`,
    remoteUrl: `${web}/commit/${c.sha}`,
  };
}
