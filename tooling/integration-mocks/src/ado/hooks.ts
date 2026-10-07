/**
 * Service hook notifications ("Web Hooks" consumer) the stand-in sends to registered webhooks, in the shape
 * Azure DevOps Server posts them: an event envelope with `resource` and `resourceContainers`.
 */
import { serializeCommit, serializeRepo } from './git';
import {
  type AdoPullRequestState,
  type AdoRepoState,
  type AdoState,
  guidFrom,
  type WorkItemState,
} from './state';
import { current, identityRef, serialize, type Urls } from './work-items';

function envelope(
  state: AdoState,
  urls: Urls,
  eventType: string,
  projectId: string,
  text: string,
  resource: unknown,
) {
  state.notifications += 1;
  const n = state.notifications;
  return {
    subscriptionId: guidFrom(`subscription:${eventType}`),
    notificationId: n,
    id: guidFrom(`event:${n}:${eventType}`),
    eventType,
    publisherId: 'tfs',
    message: { text, html: text, markdown: text },
    detailedMessage: { text, html: text, markdown: text },
    resource,
    resourceVersion: '1.0',
    resourceContainers: {
      collection: { id: state.collection.id, baseUrl: `${urls.api}/` },
      server: { id: state.serverId, baseUrl: `${urls.api.replace(/\/[^/]+$/, '')}/` },
      project: { id: projectId, baseUrl: `${urls.api}/` },
    },
    createdDate: new Date().toISOString(),
  };
}

const label = (item: WorkItemState) => {
  const f = current(item).fields;
  return `${String(f['System.WorkItemType'])} #${item.id} (${String(f['System.Title'])})`;
};

export function workItemEvent(
  state: AdoState,
  urls: Urls,
  eventType: 'workitem.created' | 'workitem.deleted' | 'workitem.restored' | 'workitem.commented',
  item: WorkItemState,
  by: string,
) {
  const who = identityRef(state, urls, by)?.displayName ?? 'Someone';
  const verb = {
    'workitem.created': 'created',
    'workitem.deleted': 'deleted',
    'workitem.restored': 'restored',
    'workitem.commented': 'commented on',
  }[eventType];
  const rev = current(item);
  return envelope(
    state,
    urls,
    eventType,
    item.projectId,
    `${label(item)} ${verb} by ${who}`,
    serialize(state, urls, item, rev, { expand: 'relations', links: true }),
  );
}

export function workItemUpdated(
  state: AdoState,
  urls: Urls,
  item: WorkItemState,
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  by: string,
) {
  const rev = current(item);
  const prev = item.revisions.at(-2);
  const who = identityRef(state, urls, by);
  const fields: Record<string, unknown> = {
    'System.Rev': { oldValue: prev?.rev, newValue: rev.rev },
    'System.ChangedDate': {
      oldValue: prev?.fields['System.ChangedDate'],
      newValue: rev.fields['System.ChangedDate'],
    },
  };
  for (const [k, v] of Object.entries(changes)) fields[k] = v;
  return envelope(
    state,
    urls,
    'workitem.updated',
    item.projectId,
    `${label(item)} updated by ${who?.displayName ?? 'Someone'}`,
    {
      id: rev.rev,
      workItemId: item.id,
      rev: rev.rev,
      revisedBy: who,
      revisedDate: rev.fields['System.ChangedDate'],
      fields,
      _links: {
        self: { href: `${urls.api}/_apis/wit/workItems/${item.id}/updates/${rev.rev}` },
        parent: { href: `${urls.api}/_apis/wit/workItems/${item.id}` },
      },
      url: `${urls.api}/_apis/wit/workItems/${item.id}/updates/${rev.rev}`,
      revision: serialize(state, urls, item, rev, { expand: 'none' }),
    },
  );
}

export function pushEvent(
  state: AdoState,
  urls: Urls,
  repo: AdoRepoState,
  refName: string,
  oldSha: string,
  newSha: string,
  by: string,
) {
  repo.pushes += 1;
  const repoJson = serializeRepo(state, urls, repo);
  const who = identityRef(state, urls, by);
  const commit = repo.commits[newSha]!;
  return envelope(
    state,
    urls,
    'git.push',
    repo.projectId,
    `${who?.displayName ?? 'Someone'} pushed updates to ${repo.name}:${refName.replace('refs/heads/', '')}`,
    {
      commits: [serializeCommit(urls, repo, commit, repoJson.webUrl)],
      refUpdates: [{ name: refName, oldObjectId: oldSha, newObjectId: newSha }],
      repository: repoJson,
      pushedBy: who,
      pushId: repo.pushes,
      date: new Date().toISOString(),
      url: `${repoJson.url}/pushes/${repo.pushes}`,
    },
  );
}

export function pullRequestEvent(
  state: AdoState,
  urls: Urls,
  eventType: 'git.pullrequest.created' | 'git.pullrequest.updated' | 'git.pullrequest.merged',
  pr: AdoPullRequestState,
  json: unknown,
) {
  const repo = state.repos.find((r) => r.id === pr.repoId)!;
  const who = identityRef(state, urls, pr.createdBy);
  return envelope(
    state,
    urls,
    eventType,
    repo.projectId,
    `${who?.displayName ?? 'Someone'} ${eventType === 'git.pullrequest.created' ? 'created' : 'updated'} pull request ${pr.id} (${pr.title}) in ${repo.name}`,
    json,
  );
}
