import {
  ErrorCodes,
  HttpError,
  type RemoteChangesPage,
  type RemoteComment,
  type RemoteFieldDef,
  type RemoteRecord,
  type RemoteWriteOptions,
  type SyncFieldType,
} from '@isbp/sdk/server';
import {
  catalogEntry,
  changesWiql,
  compareFeed,
  customFieldType,
  decodeCursor,
  encodeCursor,
  type FeedCursor,
  fromDay,
  HIERARCHY_REVERSE,
  identityValue,
  type IdentityRef,
  isCustomField,
  isIdentityRef,
  joinTags,
  PARENT_KEY,
  parseIdentityString,
  type ProjectTypeInfo,
  PRIORITIES,
  splitTags,
  textToHtml,
  toDay,
  WORK_ITEM_FIELDS,
  workItemCatalog,
} from '../model';
import { type AzdoConn, azdo, collectionUrl, seg } from './client';
import {
  identityForWrite,
  type ListOf,
  once,
  projectIdByName,
  projectIndex,
  resolveEmails,
  resolveProject,
  toRemoteUser,
} from './shared';

/* ───────────────────────────── API shapes ───────────────────────────── */

export interface AzdoRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

export interface AzdoWorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: AzdoRelation[];
  url?: string;
}

interface AzdoWorkItemType {
  name: string;
  referenceName?: string;
  isDisabled?: boolean;
  states?: { name: string; category?: string }[];
  /** State → allowed next states; `''` is the initial transition. */
  transitions?: Record<string, unknown>;
  fields?: { referenceName: string; name?: string }[];
}

interface AzdoFieldDef {
  referenceName: string;
  name: string;
  type?: string;
  isIdentity?: boolean;
  readOnly?: boolean;
}

interface AzdoComment {
  id: number;
  workItemId?: number;
  text?: string;
  format?: string;
  createdBy?: IdentityRef;
  createdDate?: string;
  isDeleted?: boolean;
}

interface WiqlResult {
  asOf?: string;
  workItems?: { id: number }[];
}

type PatchOp =
  { op: 'add' | 'replace' | 'test'; path: string; value: unknown } | { op: 'remove'; path: string };

/* ───────────────────────────── types and fields ───────────────────────────── */

const TYPES_TTL = 600;
const FIELDS_TTL = 3600;

/** Work item types of a team project with their states and fields, cached for ten minutes. */
export function projectTypes(conn: AzdoConn, projectId: string): Promise<ProjectTypeInfo[]> {
  return once(conn, `types:${projectId}`, async () => {
    const key = `types:${projectId}`;
    const cached = await conn.cache.get<ProjectTypeInfo[]>(key);
    if (cached) return cached;
    const res = await azdo<ListOf<AzdoWorkItemType>>(conn, `${seg(projectId)}/_apis/wit/workitemtypes`);
    const types: ProjectTypeInfo[] = [];
    for (const t of res.body?.value ?? []) {
      if (t.isDisabled) continue;
      let states = t.states?.map((s) => s.name);
      if (!states?.length) {
        // Not in the type on some servers: the states resource (a preview before 7.0, retried as one), then
        // the transitions' keys.
        const s = await azdo<ListOf<{ name: string }>>(
          conn,
          `${seg(projectId)}/_apis/wit/workitemtypes/${seg(t.name)}/states`,
          { allow: [404] },
        );
        states = s.status === 404 ? [] : (s.body?.value ?? []).map((x) => x.name);
        if (!states.length) states = Object.keys(t.transitions ?? {}).filter(Boolean);
      }
      types.push({ name: t.name, states, fields: (t.fields ?? []).map((f) => f.referenceName) });
    }
    await conn.cache.set(key, types, TYPES_TTL);
    return types;
  });
}

/** The collection's field definitions (names and types of custom fields), cached for an hour. */
function fieldDefinitions(conn: AzdoConn): Promise<AzdoFieldDef[]> {
  return once(conn, 'fielddefs', async () => {
    const cached = await conn.cache.get<AzdoFieldDef[]>('fielddefs');
    if (cached) return cached;
    const res = await azdo<ListOf<AzdoFieldDef>>(conn, '_apis/wit/fields');
    const defs = (res.body?.value ?? []).map((f) => ({
      referenceName: f.referenceName,
      name: f.name,
      type: f.type,
      isIdentity: f.isIdentity,
      readOnly: f.readOnly,
    }));
    await conn.cache.set('fielddefs', defs, FIELDS_TTL);
    return defs;
  });
}

/** The work item field catalogue of a team project (or of the system processes without one). */
export async function workItemFields(
  conn: AzdoConn,
  scope: string | null | undefined,
): Promise<RemoteFieldDef[]> {
  if (!scope) return workItemCatalog(null);
  const projectId = await resolveProject(conn, scope);
  const types = await projectTypes(conn, projectId);
  const customKeys = [...new Set(types.flatMap((t) => t.fields))].filter(isCustomField);
  const custom: { key: string; label: string; type: SyncFieldType }[] = [];
  if (customKeys.length) {
    const defs = new Map((await fieldDefinitions(conn)).map((d) => [d.referenceName, d]));
    for (const key of customKeys.sort()) {
      const def = defs.get(key);
      const type = def && !def.readOnly ? customFieldType(def) : null;
      if (type) custom.push({ key, label: def!.name, type });
    }
  }
  return workItemCatalog(types, custom);
}

/* ───────────────────────────── reading ───────────────────────────── */

/** Work item id at the end of a relation URL (`…/_apis/wit/workItems/42`). */
export function relationTarget(url: string): string | null {
  const m = /\/workitems\/(\d+)\/?$/i.exec(url);
  return m ? m[1]! : null;
}

function parentOf(item: AzdoWorkItem): string | null {
  const rel = item.relations?.find((r) => r.rel === HIERARCHY_REVERSE);
  if (rel) return relationTarget(rel.url);
  const field = item.fields['System.Parent'];
  return typeof field === 'number' && field > 0 ? String(field) : null;
}

function readValue(type: SyncFieldType, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return type === 'tags' ? [] : null;
  switch (type) {
    case 'choice':
      return String(raw);
    case 'tags':
      return splitTags(raw);
    case 'number':
      return typeof raw === 'number' ? raw : Number.isFinite(Number(raw)) ? Number(raw) : null;
    case 'date':
      return toDay(raw);
    case 'datetime':
      return typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : raw === 'true' || raw === 'True';
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

/**
 * Work items as remote records: known fields converted (dates to days, tags to lists, identities to remote
 * users with emails), custom fields as they are, the parent from the hierarchy relation, the team project as
 * the scope, and `rev` as the version. `scopeFilter` marks items that moved out of that project as deleted.
 */
export async function toRecords(
  conn: AzdoConn,
  items: AzdoWorkItem[],
  scopeFilter?: string | null,
): Promise<RemoteRecord[]> {
  // Identities are objects from api-version 5.0 on; text (`Name <DOMAIN\\alias>`) is read too.
  const identityOf = (key: string, raw: unknown): IdentityRef | null =>
    isIdentityRef(raw)
      ? raw
      : typeof raw === 'string' && catalogEntry(key)?.type === 'user'
        ? parseIdentityString(raw)
        : null;
  const refs: IdentityRef[] = [];
  for (const item of items)
    for (const [k, v] of Object.entries(item.fields)) {
      const ref = identityOf(k, v);
      if (ref) refs.push(ref);
    }
  const emails = await resolveEmails(conn, refs);
  const base = collectionUrl(conn);
  const out: RemoteRecord[] = [];
  for (const item of items) {
    const f = item.fields;
    const values: Record<string, unknown> = {};
    for (const entry of WORK_ITEM_FIELDS) {
      if (entry.key === PARENT_KEY) continue;
      const raw = f[entry.key];
      if (entry.type === 'user') {
        const ref = identityOf(entry.key, raw);
        values[entry.key] = ref ? toRemoteUser(ref, emails) : null;
      } else values[entry.key] = readValue(entry.type, raw);
    }
    for (const [key, raw] of Object.entries(f))
      if (isCustomField(key)) values[key] = isIdentityRef(raw) ? toRemoteUser(raw, emails) : (raw ?? null);
    const parentId = parentOf(item);
    values[PARENT_KEY] = parentId;
    const projectName = typeof f['System.TeamProject'] === 'string' ? f['System.TeamProject'] : '';
    const scope = await projectIdByName(conn, projectName);
    const type = typeof f['System.WorkItemType'] === 'string' ? f['System.WorkItemType'] : 'Work Item';
    const changed =
      typeof f['System.ChangedDate'] === 'string' ? f['System.ChangedDate'] : new Date().toISOString();
    const record: RemoteRecord = {
      id: String(item.id),
      ref: `${type} ${item.id}`,
      title: typeof f['System.Title'] === 'string' ? f['System.Title'] : '',
      url: projectName
        ? `${base}/${seg(projectName)}/_workitems/edit/${item.id}`
        : `${base}/_workitems/edit/${item.id}`,
      version: String(item.rev),
      updatedAt: new Date(changed).toISOString(),
      parentId,
      scope,
      values,
    };
    if (scopeFilter && scope && scope !== scopeFilter) record.deleted = true;
    out.push(record);
  }
  return out;
}

const MAX_BATCH = 200;

/** Reads work items with their relations in batches of 200. Missing (deleted) ids are left out. */
async function readBatch(conn: AzdoConn, ids: number[]): Promise<AzdoWorkItem[]> {
  const out: AzdoWorkItem[] = [];
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const res = await azdo<ListOf<AzdoWorkItem | null>>(conn, '_apis/wit/workitemsbatch', {
      method: 'POST',
      body: { ids: ids.slice(i, i + MAX_BATCH), $expand: 'Relations', errorPolicy: 'Omit' },
    });
    out.push(...(res.body?.value ?? []).filter((x): x is AzdoWorkItem => Boolean(x && x.fields)));
  }
  return out;
}

const positiveId = (id: string) => (/^\d{1,10}$/.test(id) && Number(id) > 0 ? Number(id) : null);

async function readOne(conn: AzdoConn, id: string): Promise<AzdoWorkItem | null> {
  const n = positiveId(id);
  if (!n) return null;
  const res = await azdo<AzdoWorkItem>(conn, `_apis/wit/workitems/${n}`, {
    query: { $expand: 'Relations' },
    allow: [404],
  });
  return res.status === 404 || !res.body?.fields ? null : res.body;
}

export async function getWorkItem(
  conn: AzdoConn,
  id: string,
  scope?: string | null,
): Promise<RemoteRecord | null> {
  const item = await readOne(conn, id);
  if (!item) return null;
  const scopeId = scope ? await resolveProject(conn, scope) : null;
  return (await toRecords(conn, [item], scopeId))[0]!;
}

/**
 * The change feed of a team project: WIQL for the ids changed after the cursor (oldest first, ties broken by
 * id), then a batched read with relations. The cursor is the last record's change time and id, but only
 * records unchanged since the query (change time up to the query's `asOf`) may move it: an item edited while
 * the page was read is returned with its new values and again in a later page, so nothing in between is
 * skipped. Items deleted meanwhile are left out (the `workitem.deleted` hook and `get` report them).
 */
export async function workItemChanges(
  conn: AzdoConn,
  opts: { scope?: string | null; cursor: string | null; limit: number },
): Promise<RemoteChangesPage> {
  const projectId = await resolveProject(conn, opts.scope);
  const cursor = decodeCursor(opts.cursor);
  if (opts.cursor && (!cursor || !/^\d{1,10}$/.test(cursor.id)))
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid change feed cursor', {
      issues: [{ path: 'cursor', message: 'invalid' }],
    });
  const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(opts.limit) || 100));
  const wiql = await azdo<WiqlResult>(conn, `${seg(projectId)}/_apis/wit/wiql`, {
    method: 'POST',
    query: { $top: limit, timePrecision: true },
    body: { query: changesWiql(cursor) },
  });
  const ids = (wiql.body?.workItems ?? []).map((w) => w.id).slice(0, limit);
  if (!ids.length) return { items: [], cursor: opts.cursor, hasMore: false };
  const asOf =
    wiql.body?.asOf && !Number.isNaN(Date.parse(wiql.body.asOf)) ? Date.parse(wiql.body.asOf) : null;
  const records = (await toRecords(conn, await readBatch(conn, ids))).filter(
    (r) => !cursor || compareFeed({ at: r.updatedAt, id: r.id }, cursor) > 0,
  );
  records.sort((a, b) => compareFeed({ at: a.updatedAt, id: a.id }, { at: b.updatedAt, id: b.id }));
  for (const r of records) r.scope ??= projectId;
  const settled = records.filter((r) => asOf === null || Date.parse(r.updatedAt) <= asOf);
  const last = settled.at(-1);
  const next: FeedCursor | null = last ? { at: last.updatedAt, id: last.id } : cursor;
  // A full page that moved nothing (every item changed again meanwhile) ends the run; the next one resumes.
  const hasMore = ids.length >= limit && Boolean(last);
  return { items: records, cursor: next ? encodeCursor(next) : null, hasMore };
}

/* ───────────────────────────── writing ───────────────────────────── */

const invalid = (path: string, message: string) =>
  new HttpError(422, ErrorCodes.VALIDATION_FAILED, `Invalid value for ${path}`, {
    issues: [{ path, message }],
  });

/** A value in the shape Azure DevOps stores, or null to clear the field. */
export function toRemoteValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const entry = catalogEntry(key);
  const type = entry?.type;
  if (key === 'Microsoft.VSTS.Common.Priority') {
    const p = String(value);
    if (!(PRIORITIES as readonly string[]).includes(p)) throw invalid(key, `"${p}" is not a choice`);
    return Number(p);
  }
  switch (type) {
    case 'tags': {
      const joined = joinTags(value);
      return joined || null;
    }
    case 'user':
      return identityValue(value);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw invalid(key, 'expected a number');
      return n;
    }
    case 'date': {
      const day = toDay(value);
      if (!day) throw invalid(key, 'expected YYYY-MM-DD');
      return fromDay(day);
    }
    case 'string':
    case 'html':
    case 'choice':
      return typeof value === 'string' ? (value === '' ? null : value) : String(value);
    default:
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) return identityValue(value);
      if (Array.isArray(value)) return value.join('; ');
      return value === '' ? null : value;
  }
}

/** Fields that exist on every work item type (never skipped for a type that doesn't list them). */
const SYSTEM_ALWAYS = new Set(WORK_ITEM_FIELDS.filter((f) => f.key.startsWith('System.')).map((f) => f.key));

/**
 * The JSON Patch for a create or an update. Fields the work item type doesn't have (a Target Date on an
 * Agile Task) are left out: the record the call returns shows what Azure DevOps kept. `current` is the item
 * being updated (null when creating).
 */
export function buildPatch(
  values: Record<string, unknown>,
  opts: {
    current: AzdoWorkItem | null;
    typeFields: Set<string> | null;
    parent: string | null | undefined;
    base: string;
  },
): PatchOp[] {
  const ops: PatchOp[] = [];
  const { current } = opts;
  for (const [key, value] of Object.entries(values)) {
    if (key === PARENT_KEY) continue;
    if (key === 'System.WorkItemType') {
      if (current && value !== current.fields['System.WorkItemType'])
        throw invalid(key, 'can only be set when creating');
      continue;
    }
    const entry = catalogEntry(key);
    if (entry?.readOnly || key === 'System.Id' || key === 'System.Rev' || key === 'System.TeamProject')
      throw invalid(key, 'read-only');
    if (opts.typeFields && !SYSTEM_ALWAYS.has(key) && !opts.typeFields.has(key)) continue;
    const remote = toRemoteValue(key, value);
    const path = `/fields/${key}`;
    if (remote === null || remote === '') {
      const existing = current?.fields[key];
      if (existing !== undefined && existing !== null && existing !== '') ops.push({ op: 'remove', path });
    } else ops.push({ op: 'add', path, value: remote });
  }
  if (opts.parent !== undefined) {
    const want = opts.parent === null || opts.parent === '' ? null : String(opts.parent);
    if (want !== null && !positiveId(want)) throw invalid(PARENT_KEY, 'expected a work item id');
    if (want !== null && current && want === String(current.id))
      throw invalid(PARENT_KEY, 'a work item cannot be its own parent');
    const relations = current?.relations ?? [];
    const index = relations.findIndex((r) => r.rel === HIERARCHY_REVERSE);
    const existing = index >= 0 ? relationTarget(relations[index]!.url) : null;
    if (want !== existing) {
      if (index >= 0) ops.push({ op: 'remove', path: `/relations/${index}` });
      if (want)
        ops.push({
          op: 'add',
          path: '/relations/-',
          value: {
            rel: HIERARCHY_REVERSE,
            url: `${opts.base}/_apis/wit/workItems/${want}`,
            attributes: { comment: '' },
          },
        });
    }
  }
  return ops;
}

/** Identity fields as the strings Azure DevOps resolves (see `identityForWrite`). */
async function resolveIdentities(
  conn: AzdoConn,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(values)) {
    const user =
      catalogEntry(key)?.type === 'user' ||
      (isCustomField(key) && typeof value === 'object' && value !== null && !Array.isArray(value));
    if (user) out[key] = await identityForWrite(conn, value);
  }
  return out;
}

/** `values.parent` when given, else `opts.parentId`; undefined leaves the parent alone. */
function parentInput(values: Record<string, unknown>, opts: RemoteWriteOptions): string | null | undefined {
  if (Object.hasOwn(values, PARENT_KEY)) return (values[PARENT_KEY] as string | null) ?? null;
  return opts.parentId === undefined ? undefined : opts.parentId;
}

export async function createWorkItem(
  conn: AzdoConn,
  values: Record<string, unknown>,
  opts: RemoteWriteOptions,
): Promise<RemoteRecord> {
  const projectId = await resolveProject(conn, opts.scope);
  const type = values['System.WorkItemType'];
  if (typeof type !== 'string' || !type.trim()) throw invalid('System.WorkItemType', 'required');
  const types = await projectTypes(conn, projectId);
  const info = types.find((t) => t.name.toLowerCase() === type.toLowerCase());
  const ops = buildPatch(await resolveIdentities(conn, values), {
    current: null,
    typeFields: info ? new Set(info.fields) : null,
    parent: parentInput(values, opts),
    base: collectionUrl(conn),
  });
  const res = await azdo<AzdoWorkItem>(
    conn,
    `${seg(projectId)}/_apis/wit/workitems/$${seg(info?.name ?? type)}`,
    {
      method: 'POST',
      query: { $expand: 'Relations' },
      body: ops,
      contentType: 'application/json-patch+json',
    },
  );
  return (await toRecords(conn, [res.body]))[0]!;
}

export async function updateWorkItem(
  conn: AzdoConn,
  id: string,
  values: Record<string, unknown>,
  opts: RemoteWriteOptions,
): Promise<RemoteRecord> {
  const current = await readOne(conn, id);
  if (!current) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Work item ${id} was not found`, { id });
  const expected = opts.expectedVersion ?? null;
  if (expected !== null && String(current.rev) !== String(expected))
    throw new HttpError(
      409,
      ErrorCodes.REMOTE_CONFLICT,
      'The work item changed in Azure DevOps since it was read',
      {
        expectedVersion: String(expected),
        version: String(current.rev),
      },
    );
  const projectId =
    (await projectIdByName(conn, current.fields['System.TeamProject'])) ??
    (opts.scope ? await resolveProject(conn, opts.scope) : null);
  const types = projectId ? await projectTypes(conn, projectId) : [];
  const info = types.find((t) => t.name === current.fields['System.WorkItemType']);
  const ops = buildPatch(await resolveIdentities(conn, values), {
    current,
    typeFields: info ? new Set(info.fields) : null,
    parent: parentInput(values, opts),
    base: collectionUrl(conn),
  });
  if (!ops.length) return (await toRecords(conn, [current]))[0]!;
  // The test makes the write atomic with the read above: a change in between fails it (409 REMOTE_CONFLICT).
  const patch: PatchOp[] = [{ op: 'test', path: '/rev', value: current.rev }, ...ops];
  const res = await azdo<AzdoWorkItem>(conn, `_apis/wit/workitems/${current.id}`, {
    method: 'PATCH',
    query: { $expand: 'Relations' },
    body: patch,
    contentType: 'application/json-patch+json',
  });
  return (await toRecords(conn, [res.body]))[0]!;
}

/* ───────────────────────────── comments ───────────────────────────── */

/**
 * The Comments API is a preview on every server version: 7.2-preview.4 (Azure DevOps Server), 7.1-preview.4
 * (2022.1), 7.0-preview.3 (2022), 6.0-preview.3 (2020), 5.1-preview.3 (2019 Update 1). Server 2019 (5.0) only
 * has the older read-only discussion API (5.0-preview.2, one entry per revision); comments are added there by
 * writing `System.History`. Since Azure DevOps Server (2025), the API adds at most 1,000 comments per work
 * item: the refusal is a 4xx, so `REMOTE_REJECTED` with the server's message.
 */
export const commentsVersion = (v: string) =>
  v === '7.2' || v === '7.1' ? `${v}-preview.4` : v === '5.0' ? '5.0-preview.2' : `${v}-preview.3`;

/** A comment from either API generation (`id`/`createdBy`/`createdDate`, or 2019's `revision`/`revisedBy`/`revisedDate`). */
interface AnyComment extends AzdoComment {
  revision?: number;
  revisedBy?: IdentityRef;
  revisedDate?: string;
}

async function commentProject(conn: AzdoConn, id: string, scope?: string | null): Promise<string | null> {
  if (scope) return resolveProject(conn, scope);
  const item = await readOne(conn, id);
  return item ? projectIdByName(conn, item.fields['System.TeamProject']) : null;
}

function commentParts(c: AnyComment) {
  return {
    id: String(c.id ?? c.revision),
    ref: c.createdBy ?? c.revisedBy ?? {},
    at: c.createdDate ?? c.revisedDate,
  };
}

async function toComment(conn: AzdoConn, c: AnyComment): Promise<RemoteComment> {
  const { id, ref, at } = commentParts(c);
  const emails = await resolveEmails(conn, [ref]);
  return {
    id,
    body: c.text ?? '',
    format: c.format?.toLowerCase() === 'markdown' ? 'markdown' : 'html',
    author: toRemoteUser(ref, emails),
    createdAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
  };
}

export async function listComments(
  conn: AzdoConn,
  id: string,
  scope?: string | null,
): Promise<RemoteComment[]> {
  const n = positiveId(id);
  if (!n) return [];
  const project = await commentProject(conn, id, scope);
  if (!project) return [];
  const legacy = conn.config.apiVersion === '5.0';
  const all: AnyComment[] = [];
  let token: string | undefined;
  let fromRevision = 1;
  for (let page = 0; page < 50; page++) {
    const res = await azdo<{
      comments?: AnyComment[];
      value?: AnyComment[];
      continuationToken?: string | null;
      totalCount?: number;
    }>(conn, `${seg(project)}/_apis/wit/workItems/${n}/comments`, {
      query: legacy
        ? { fromRevision, $top: 200, order: 'asc' }
        : { $top: 200, order: 'asc', continuationToken: token },
      apiVersion: commentsVersion(conn.config.apiVersion),
      allow: [404],
    });
    if (res.status === 404) return [];
    // 2019's documentation shows the list as `value` in places; the definition says `comments`.
    const batch = res.body?.comments ?? res.body?.value ?? [];
    all.push(...batch);
    if (legacy) {
      const last = batch.at(-1)?.revision;
      if (!batch.length || last === undefined || batch.length < 200) break;
      fromRevision = last + 1;
    } else {
      token = res.body?.continuationToken ?? undefined;
      if (!token) break;
    }
  }
  const visible = all.filter((c) => !c.isDeleted);
  await resolveEmails(
    conn,
    visible.map((c) => commentParts(c).ref),
  );
  const out: RemoteComment[] = [];
  for (const c of visible) out.push(await toComment(conn, c));
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(a.id) - Number(b.id));
}

export async function addComment(
  conn: AzdoConn,
  id: string,
  comment: { body: string; format: 'html' | 'text' | 'markdown'; internal?: boolean },
  scope?: string | null,
): Promise<RemoteComment> {
  if (comment.internal)
    throw new HttpError(409, ErrorCodes.NOT_SUPPORTED, 'Azure DevOps work items have no internal comments');
  const n = positiveId(id);
  const project = n ? await commentProject(conn, id, scope) : null;
  if (!n || !project) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Work item ${id} was not found`, { id });
  // From 7.1 (Server 2022.1) the format must be named and Markdown is kept as is; older versions store HTML.
  const v71 = conn.config.apiVersion === '7.1' || conn.config.apiVersion === '7.2';
  const markdown = v71 && comment.format === 'markdown';
  const text = comment.format === 'html' || markdown ? comment.body : textToHtml(comment.body);
  if (conn.config.apiVersion === '5.0') {
    // Server 2019: a discussion entry is a revision with System.History.
    const res = await azdo<AzdoWorkItem>(conn, `_apis/wit/workitems/${n}`, {
      method: 'PATCH',
      body: [{ op: 'add', path: '/fields/System.History', value: text }],
      contentType: 'application/json-patch+json',
    });
    const f = res.body.fields;
    const by = f['System.ChangedBy'];
    return toComment(conn, {
      id: res.body.rev,
      text,
      createdBy: isIdentityRef(by) ? by : typeof by === 'string' ? (parseIdentityString(by) ?? {}) : {},
      createdDate: typeof f['System.ChangedDate'] === 'string' ? f['System.ChangedDate'] : undefined,
    });
  }
  const res = await azdo<AzdoComment>(conn, `${seg(project)}/_apis/wit/workItems/${n}/comments`, {
    method: 'POST',
    query: v71 ? { format: markdown ? 'markdown' : 'html' } : undefined,
    body: { text },
    apiVersion: commentsVersion(conn.config.apiVersion),
  });
  return toComment(conn, res.body);
}

/** Team projects to choose from as a profile's scope. */
export async function projectScopes(conn: AzdoConn) {
  return (await projectIndex(conn))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
