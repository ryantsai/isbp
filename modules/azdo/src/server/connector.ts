import { type ConnectorHandler, ErrorCodes, HttpError } from '@isbp/sdk/server';
import type { AzdoConfig, AzdoSecrets, ObjectType } from '../contracts';
import { defaultMapping, PROJECT_FIELDS, parseServiceHook, REPOSITORY_FIELDS } from '../model';
import { type AzdoConn, azdo, collectionUrl } from './client';
import { getProject, projectChanges } from './projects';
import { getRepository, repositoryChanges } from './repositories';
import { listProjects } from './shared';
import {
  addComment,
  createWorkItem,
  getWorkItem,
  listComments,
  projectScopes,
  updateWorkItem,
  workItemChanges,
  workItemFields,
} from './work-items';

const unknownObject = (objectType: string) =>
  new HttpError(404, ErrorCodes.NOT_FOUND, `azdo.server has no object type ${objectType}`);

const notSupported = (what: string) =>
  new HttpError(409, ErrorCodes.NOT_SUPPORTED, `${what} is not supported`);

interface ConnectionData {
  authenticatedUser?: { providerDisplayName?: string; properties?: { Account?: { $value?: string } } };
}

/** Who the token belongs to, from the location service (best effort: older servers may not answer). */
async function signedInAs(conn: AzdoConn): Promise<string | null> {
  try {
    const res = await azdo<ConnectionData>(conn, '_apis/connectionData', {
      apiVersion: '',
      allow: [400, 404],
    });
    const user = res.status < 300 ? res.body?.authenticatedUser : undefined;
    return user?.providerDisplayName ?? user?.properties?.Account?.$value ?? null;
  } catch (err) {
    if ((err as HttpError).code === ErrorCodes.REMOTE_AUTH_FAILED) throw err;
    return null;
  }
}

/**
 * `azdo.server`: Azure DevOps Server 2020+ through its REST API with a personal access token. Objects:
 * `project` (team projects, read-only), `work-item` (per team project; create, update with `test /rev`,
 * hierarchy, comments, service hooks) and `repository` (per team project; Git status, read-only).
 */
export const serverConnector: ConnectorHandler<AzdoConfig, AzdoSecrets> = {
  hosts: (config) => [new URL(config.collectionUrl.trim()).hostname],

  async test(conn) {
    const projects = await listProjects(conn);
    const user = await signedInAs(conn);
    const url = new URL(collectionUrl(conn));
    const collection = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname);
    return {
      ok: true,
      account: `${collection} on ${url.host}${user ? ` as ${user}` : ''} (${projects.length} team projects)`,
    };
  },

  async scopes(conn, objectType) {
    if (objectType === 'project') return [];
    if (objectType !== 'work-item' && objectType !== 'repository') throw unknownObject(objectType);
    return projectScopes(conn);
  },

  async fields(conn, objectType, scope) {
    switch (objectType as ObjectType) {
      case 'project':
        return PROJECT_FIELDS;
      case 'repository':
        return REPOSITORY_FIELDS;
      case 'work-item':
        return workItemFields(conn, scope);
      default:
        throw unknownObject(objectType);
    }
  },

  async changes(conn, objectType, opts) {
    switch (objectType as ObjectType) {
      case 'project':
        return projectChanges(conn, opts);
      case 'work-item':
        return workItemChanges(conn, opts);
      case 'repository':
        return repositoryChanges(conn, opts);
      default:
        throw unknownObject(objectType);
    }
  },

  async get(conn, objectType, id, opts) {
    switch (objectType as ObjectType) {
      case 'project':
        return getProject(conn, id);
      case 'work-item':
        return getWorkItem(conn, id, opts?.scope);
      case 'repository':
        return getRepository(conn, id, opts?.scope);
      default:
        throw unknownObject(objectType);
    }
  },

  async create(conn, objectType, values, opts) {
    if (objectType !== 'work-item') throw notSupported(`Creating ${objectType}`);
    return createWorkItem(conn, values, opts);
  },

  async update(conn, objectType, id, values, opts) {
    if (objectType !== 'work-item') throw notSupported(`Updating ${objectType}`);
    return updateWorkItem(conn, id, values, opts);
  },

  comments: {
    async list(conn, objectType, id, opts) {
      if (objectType !== 'work-item') throw notSupported(`Comments on ${objectType}`);
      return listComments(conn, id, opts?.scope);
    },
    async add(conn, objectType, id, comment, opts) {
      if (objectType !== 'work-item') throw notSupported(`Comments on ${objectType}`);
      return addComment(conn, id, comment, opts?.scope);
    },
  },

  async webhook(_conn, req) {
    return parseServiceHook(req.body);
  },

  defaultMapping,
};
