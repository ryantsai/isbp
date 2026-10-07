/**
 * Work item behaviour of the Azure DevOps stand-in: reading (current or as of a moment), JSON Patch writes
 * with the server's rules (required title, allowed states and priorities, known identities and paths,
 * one parent, no cycles), revisions, comments and the shapes the REST API returns.
 */
import {
  type AdoIdentity,
  type AdoProjectState,
  type AdoRelation,
  type AdoState,
  FIELD_DEFS,
  type IdentityValue,
  isIdentityValue,
  typeOf,
  type TypeDef,
  type WorkItemRevision,
  type WorkItemState,
} from './state';

/** An error the REST API reports as `{ message, typeName, typeKey, errorCode, eventId }` with a status. */
export class AdoError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly typeKey: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** Assembly-qualified type name, as the server sends it. */
  get typeName(): string {
    if (this.typeKey === 'TestPatchOperationFailedException')
      return 'Microsoft.VisualStudio.Services.WebApi.Patch.TestPatchOperationFailedException, Microsoft.VisualStudio.Services.WebApi';
    if (this.typeKey === 'VssPropertyValidationException')
      return 'Microsoft.VisualStudio.Services.Common.VssPropertyValidationException, Microsoft.VisualStudio.Services.Common';
    if (this.typeKey.startsWith('Vss'))
      return `Microsoft.VisualStudio.Services.WebApi.${this.typeKey}, Microsoft.VisualStudio.Services.WebApi`;
    if (this.workItemTracking)
      return `Microsoft.TeamFoundation.WorkItemTracking.Server.${this.typeKey}, Microsoft.TeamFoundation.WorkItemTracking.Server`;
    if (this.typeKey.startsWith('Git'))
      return `Microsoft.TeamFoundation.Git.Server.${this.typeKey}, Microsoft.TeamFoundation.Git.Server`;
    return `Microsoft.TeamFoundation.Framework.Server.${this.typeKey}, Microsoft.TeamFoundation.Framework.Server`;
  }

  /** Work item tracking exceptions carry event id 3200, the rest 3000. */
  get workItemTracking(): boolean {
    return /^(WorkItem|RuleValidation|Wiql)/.test(this.typeKey);
  }
}

export const HIERARCHY_REVERSE = 'System.LinkTypes.Hierarchy-Reverse';
export const HIERARCHY_FORWARD = 'System.LinkTypes.Hierarchy-Forward';
const KNOWN_LINKS = new Set([
  HIERARCHY_REVERSE,
  HIERARCHY_FORWARD,
  'System.LinkTypes.Related',
  'Hyperlink',
  'ArtifactLink',
]);

/** Fields only the server sets. */
const SERVER_FIELDS = new Set([
  'System.Id',
  'System.Rev',
  'System.TeamProject',
  'System.CreatedDate',
  'System.CreatedBy',
  'System.ChangedDate',
  'System.ChangedBy',
  'System.CommentCount',
  'System.Parent',
  'Microsoft.VSTS.Common.StateChangeDate',
]);

export interface Urls {
  /** `http://host/ado/DefaultCollection` (REST URLs). */
  api: string;
  /** Web URLs (`webUrl`, `_links.html`): the server's public URL. */
  web: string;
}

export const current = (item: WorkItemState) => item.revisions.at(-1)!;

export function projectOf(state: AdoState, item: WorkItemState): AdoProjectState {
  return state.projects.find((p) => p.id === item.projectId)!;
}

export function findIdentity(state: AdoState, id: string): AdoIdentity | undefined {
  return state.identities.find((i) => i.id === id);
}

/** Resolves what a client writes into an identity field: email, unique name, display name or `Name <x>`. */
export function resolveIdentity(state: AdoState, raw: string): AdoIdentity | null {
  const text = raw.trim();
  const angled = /^(.*)<([^>]+)>$/.exec(text);
  const candidates = angled ? [angled[2]!.trim(), angled[1]!.trim()] : [text];
  for (const c of candidates) {
    const lower = c.toLowerCase();
    const hit =
      state.identities.find((i) => i.uniqueName.toLowerCase() === lower) ??
      state.identities.find((i) => i.mail?.toLowerCase() === lower) ??
      state.identities.find((i) => i.id === lower);
    if (hit) return hit;
  }
  const byName = state.identities.filter((i) => i.displayName.toLowerCase() === text.toLowerCase());
  return byName.length === 1 ? byName[0]! : null;
}

export function identityRef(state: AdoState, urls: Urls, id: string) {
  const i = findIdentity(state, id);
  if (!i) return null;
  const avatar = `${urls.api}/_api/_common/identityImage?id=${i.id}`;
  return {
    displayName: i.displayName,
    url: `${urls.api}/_apis/Identities/${i.id}`,
    _links: { avatar: { href: avatar } },
    id: i.id,
    uniqueName: i.uniqueName,
    imageUrl: avatar,
    descriptor: `win.${Buffer.from(i.id).toString('base64url')}`,
  };
}

const workItemUrl = (urls: Urls, id: number) => `${urls.api}/_apis/wit/workItems/${id}`;

/** The revision in effect at `asOf` (null when the item didn't exist yet). */
export function revisionAt(item: WorkItemState, asOf?: string | null): WorkItemRevision | null {
  if (!asOf) return current(item);
  const at = Date.parse(asOf);
  if (Number.isNaN(at))
    throw new AdoError(400, `The value ${asOf} is not a valid date.`, 'ArgumentException');
  let found: WorkItemRevision | null = null;
  for (const r of item.revisions) if (Date.parse(r.fields['System.ChangedDate'] as string) <= at) found = r;
  return found;
}

export type Expand = 'none' | 'relations' | 'fields' | 'links' | 'all';

export function parseExpand(raw: unknown): Expand {
  const v = String(raw ?? 'none').toLowerCase();
  if (['none', 'relations', 'fields', 'links', 'all'].includes(v)) return v as Expand;
  throw new AdoError(400, `The value '${String(raw)}' is not valid for $expand.`, 'ArgumentException');
}

/** A work item as the REST API returns it. */
export function serialize(
  state: AdoState,
  urls: Urls,
  item: WorkItemState,
  rev: WorkItemRevision,
  opts: { expand?: Expand; fields?: string[] | null; links?: boolean } = {},
) {
  const out: Record<string, unknown> = { id: item.id, rev: rev.rev };
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rev.fields)) {
    if (opts.fields && !opts.fields.some((f) => f.toLowerCase() === k.toLowerCase())) continue;
    if (v === undefined || v === null || v === '') continue;
    fields[k] = isIdentityValue(v) ? identityRef(state, urls, v.$identity) : v;
  }
  out.fields = fields;
  const expand = opts.expand ?? 'none';
  if ((expand === 'relations' || expand === 'all') && rev.relations.length)
    out.relations = rev.relations.map((r) => ({
      rel: r.rel,
      url: r.target !== undefined ? workItemUrl(urls, r.target) : r.url,
      attributes: r.attributes,
    }));
  const project = projectOf(state, item);
  if (opts.links || expand === 'links' || expand === 'all')
    out._links = {
      self: { href: workItemUrl(urls, item.id) },
      workItemUpdates: { href: `${workItemUrl(urls, item.id)}/updates` },
      workItemRevisions: { href: `${workItemUrl(urls, item.id)}/revisions` },
      workItemComments: { href: `${workItemUrl(urls, item.id)}/comments` },
      html: { href: `${urls.web}/${encodeURIComponent(project.name)}/_workitems/edit/${item.id}` },
      workItemType: {
        href: `${urls.api}/${project.id}/_apis/wit/workItemTypes/${encodeURIComponent(String(rev.fields['System.WorkItemType']))}`,
      },
      fields: { href: `${urls.api}/_apis/wit/fields` },
    };
  out.url = workItemUrl(urls, item.id);
  return out;
}

/* ───────────────────────────── writes ───────────────────────────── */

export interface PatchOp {
  op?: string;
  path?: string;
  value?: unknown;
  from?: string;
}

const ruleError = (fieldName: string, codes: string) =>
  new AdoError(
    400,
    `TF401320: Rule Error for field ${fieldName}. Error code: ${codes}.`,
    'RuleValidationException',
    {
      customProperties: { FieldReferenceName: fieldName, FieldStatusFlags: codes },
    },
  );

const fieldMissing = (ref: string) =>
  new AdoError(400, `TF51535: Cannot find field ${ref}.`, 'WorkItemFieldInvalidException');

/** A failed `test` operation (a stale `/rev`): 412 with `TestPatchOperationFailedException`, as the server answers. */
export const testFailed = (path: string, actual: unknown, expected: unknown) =>
  new AdoError(
    412,
    `VS403351: Test Operation for path ${path} failed, value ${String(actual)} was not equal to test value ${String(expected)}.`,
    'TestPatchOperationFailedException',
  );

function coerce(
  state: AdoState,
  project: AdoProjectState,
  def: TypeDef,
  ref: string,
  value: unknown,
): unknown {
  const fd = FIELD_DEFS[ref]!;
  if (value === null || value === undefined || value === '') return null;
  switch (fd.type) {
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n))
        throw new AdoError(
          400,
          `The value ${String(value)} is not valid for field ${fd.name}.`,
          'WorkItemFieldInvalidException',
        );
      if (ref === 'Microsoft.VSTS.Common.Priority' && (n < 1 || n > 4))
        throw ruleError(fd.name, 'HasValues, LimitedToValues, AllowsOldValue');
      return n;
    }
    case 'double': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n))
        throw new AdoError(
          400,
          `The value ${String(value)} is not valid for field ${fd.name}.`,
          'WorkItemFieldInvalidException',
        );
      return n;
    }
    case 'dateTime': {
      const ms = Date.parse(String(value));
      if (Number.isNaN(ms))
        throw new AdoError(
          400,
          `The value ${String(value)} is not valid for field ${fd.name}.`,
          'WorkItemFieldInvalidException',
        );
      return new Date(ms).toISOString();
    }
    case 'identity': {
      if (typeof value !== 'string')
        throw new AdoError(
          400,
          `The value for field ${fd.name} must be a string.`,
          'WorkItemFieldInvalidException',
        );
      const who = resolveIdentity(state, value);
      if (!who)
        throw new AdoError(
          400,
          `The identity value '${value}' for field '${fd.name}' is an unknown identity.`,
          'RuleValidationException',
          {
            customProperties: {
              FieldReferenceName: ref,
              FieldStatusFlags: 'HasValues, LimitedToValues, AllowsOldValue, InvalidIdentityField',
            },
          },
        );
      return { $identity: who.id } satisfies IdentityValue;
    }
    case 'treePath': {
      const path = String(value).replace(/\//g, '\\');
      const allowed = ref === 'System.AreaPath' ? project.areas : project.iterations;
      const hit = allowed.find((a) => a.toLowerCase() === path.toLowerCase());
      if (!hit)
        throw new AdoError(
          400,
          `TF401347: Invalid tree name given for work item -1, field '${ref}'.`,
          'WorkItemFieldInvalidTreeNameException',
        );
      return hit;
    }
    case 'string': {
      const s = String(value);
      if (s.length > 255) throw ruleError(fd.name, 'HasValues, LimitedToValues, InvalidTooLong');
      if (ref === 'System.State' && !def.states.some(([st]) => st === s)) {
        const ci = def.states.find(([st]) => st.toLowerCase() === s.toLowerCase());
        if (ci) return ci[0];
        throw ruleError(fd.name, 'HasValues, LimitedToValues, AllowsOldValue, InvalidListValue');
      }
      return s;
    }
    case 'plainText': {
      if (ref === 'System.Tags')
        return (
          [
            ...new Set(
              String(value)
                .split(';')
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ].join('; ') || null
        );
      return String(value);
    }
    default:
      return String(value);
  }
}

const relationTarget = (url: unknown): number | null => {
  const m = /\/_apis\/wit\/workitems\/(\d+)\/?$/i.exec(String(url ?? ''));
  return m ? Number(m[1]) : null;
};

/** Ancestors of a work item, nearest first (for cycle checks). */
function ancestors(state: AdoState, id: number): number[] {
  const out: number[] = [];
  let at: number | undefined = id;
  for (let guard = 0; at !== undefined && guard < 1000; guard++) {
    const item: WorkItemState | undefined = state.workItems[String(at)];
    const parent: AdoRelation | undefined =
      item && current(item).relations.find((r) => r.rel === HIERARCHY_REVERSE);
    at = parent?.target;
    if (at !== undefined) out.push(at);
  }
  return out;
}

export interface WriteResult {
  item: WorkItemState;
  changed: boolean;
  /** Field changes `{ old, new }` for the service hook. */
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>;
  /** Other work items whose links changed (parents gaining or losing a child). */
  touched: { item: WorkItemState; changes: Record<string, { oldValue?: unknown; newValue?: unknown }> }[];
}

/** Server time for a change: strictly after the item's last change. */
function stamp(after: string | null): string {
  let ms = Date.now();
  if (after && Date.parse(after) >= ms) ms = Date.parse(after) + 1;
  return new Date(ms).toISOString();
}

function appendRevision(
  item: WorkItemState,
  fields: Record<string, unknown>,
  relations: AdoRelation[],
  by: string,
  at: string,
): WorkItemRevision {
  const prev = current(item);
  const rev: WorkItemRevision = {
    rev: prev.rev + 1,
    fields: {
      ...fields,
      'System.Rev': prev.rev + 1,
      'System.ChangedDate': at,
      'System.ChangedBy': { $identity: by },
    },
    relations,
  };
  // History belongs to the revision it was written in.
  delete rev.fields['System.History'];
  const parent = relations.find((r) => r.rel === HIERARCHY_REVERSE);
  if (parent?.target) rev.fields['System.Parent'] = parent.target;
  else delete rev.fields['System.Parent'];
  item.revisions.push(rev);
  return rev;
}

/**
 * Applies a JSON Patch document to a new (`item` null) or existing work item, all or nothing. Supports `add`,
 * `replace`, `remove` and `test` on `/fields/<ref>`, `/rev` and `/relations/-|<index>`.
 */
export function applyPatch(
  state: AdoState,
  opts: {
    project: AdoProjectState;
    type?: string;
    item: WorkItemState | null;
    ops: unknown;
    by: string;
    bypassRules?: boolean;
  },
): WriteResult {
  if (!Array.isArray(opts.ops) || !opts.ops.length)
    throw new AdoError(
      400,
      'You must pass a valid patch document in the body of the request.',
      'VssPropertyValidationException',
    );
  const existing = opts.item;
  const before = existing ? current(existing) : null;
  const typeName = existing ? String(before!.fields['System.WorkItemType']) : opts.type!;
  const def = typeOf(opts.project.process, typeName);
  if (!def)
    throw new AdoError(
      404,
      `VS402323: Work item type ${typeName} does not exist in project ${opts.project.name} or you do not have permission to access it.`,
      'WorkItemTypeNotFoundException',
    );
  const fields: Record<string, unknown> = before ? { ...before.fields } : {};
  let history: string | null = null;
  const relations: AdoRelation[] = before
    ? before.relations.map((r) => ({ ...r, attributes: { ...r.attributes } }))
    : [];

  for (const raw of opts.ops as PatchOp[]) {
    const op = String(raw?.op ?? '').toLowerCase();
    const path = String(raw?.path ?? '');
    if (!['add', 'replace', 'remove', 'test'].includes(op))
      throw new AdoError(
        400,
        `The operation ${op || '(none)'} is not supported.`,
        'VssPropertyValidationException',
      );
    if (path === '/rev') {
      if (op !== 'test')
        throw new AdoError(400, 'The rev can only be tested.', 'VssPropertyValidationException');
      const actual = before?.rev ?? 0;
      if (Number(raw.value) !== actual) throw testFailed('/rev', actual, raw.value);
      continue;
    }
    if (path === '/id') {
      if (op !== 'test')
        throw new AdoError(400, 'The id can only be tested.', 'VssPropertyValidationException');
      if (Number(raw.value) !== existing?.id) throw testFailed('/id', existing?.id ?? 0, raw.value);
      continue;
    }
    const fieldMatch = /^\/fields\/(.+)$/.exec(path);
    if (fieldMatch) {
      const ref = Object.keys(FIELD_DEFS).find(
        (k) => k.toLowerCase() === decodeURIComponent(fieldMatch[1]!).toLowerCase(),
      );
      if (!ref || !def.fields.includes(ref)) throw fieldMissing(decodeURIComponent(fieldMatch[1]!));
      if (op === 'test') {
        const have = fields[ref];
        const same = isIdentityValue(have)
          ? resolveIdentity(state, String(raw.value))?.id === have.$identity
          : String(have ?? '') === String(raw.value ?? '');
        if (!same)
          throw testFailed(
            path,
            isIdentityValue(have) ? findIdentity(state, have.$identity)?.uniqueName : have,
            raw.value,
          );
        continue;
      }
      if (ref === 'System.History') {
        // A discussion entry: becomes a comment of the new revision (how Server 2019 adds comments).
        if (op !== 'remove' && String(raw.value ?? '').trim()) history = String(raw.value);
        continue;
      }
      if (ref === 'System.WorkItemType') {
        if (existing && String(raw.value) !== typeName) throw ruleError('Work Item Type', 'ReadOnly');
        continue;
      }
      if (SERVER_FIELDS.has(ref) && !opts.bypassRules)
        throw new AdoError(
          400,
          `TF401326: Invalid field status 'ReadOnly' for field '${ref}'.`,
          'RuleValidationException',
        );
      if (op === 'remove') delete fields[ref];
      else {
        const value = coerce(state, opts.project, def, ref, raw.value);
        if (value === null) delete fields[ref];
        else fields[ref] = value;
      }
      continue;
    }
    const relMatch = /^\/relations\/(-|\d+)(\/.*)?$/.exec(path);
    if (relMatch) {
      if (relMatch[2])
        throw new AdoError(400, `The path ${path} is not supported.`, 'VssPropertyValidationException');
      if (op === 'add' && relMatch[1] === '-') {
        const v = (raw.value ?? {}) as { rel?: string; url?: string; attributes?: Record<string, unknown> };
        if (!v.rel || !KNOWN_LINKS.has(v.rel))
          throw new AdoError(
            400,
            `TF201032: The link type name ${String(v.rel)} is not recognized.`,
            'WorkItemLinkTypeNotRecognizedException',
          );
        if (v.rel.startsWith('System.LinkTypes.')) {
          const target = relationTarget(v.url);
          const t = target === null ? undefined : state.workItems[String(target)];
          if (!t || t.deleted)
            throw new AdoError(
              400,
              `TF201035: The work item link target ${String(v.url)} does not exist.`,
              'WorkItemLinkInvalidException',
            );
          if (existing && target === existing.id)
            throw new AdoError(
              400,
              'TF201036: You cannot add a link to the same work item.',
              'WorkItemLinkInvalidException',
            );
          if (v.rel === HIERARCHY_REVERSE) {
            if (relations.some((r) => r.rel === HIERARCHY_REVERSE))
              throw new AdoError(
                400,
                `TF201036: You cannot add a Child link between work items ${existing?.id ?? -1} and ${target} because a work item can have only one Parent link.`,
                'WorkItemLinkInvalidException',
              );
            if (existing && ancestors(state, target!).includes(existing.id))
              throw new AdoError(
                400,
                `TF201065: You can not add a Parent link between work items ${existing.id} and ${target} because it would create a circular relationship.`,
                'WorkItemLinkInvalidException',
              );
          }
          if (relations.some((r) => r.rel === v.rel && r.target === target))
            throw new AdoError(400, `TF201035: The link already exists.`, 'WorkItemLinkInvalidException');
          relations.push({
            rel: v.rel,
            target: target!,
            attributes: {
              ...(v.attributes ?? {}),
              isLocked: false,
              name:
                v.rel === HIERARCHY_REVERSE ? 'Parent' : v.rel === HIERARCHY_FORWARD ? 'Child' : 'Related',
            },
          });
        } else relations.push({ rel: v.rel, url: String(v.url ?? ''), attributes: v.attributes ?? {} });
        continue;
      }
      if (op === 'remove' && relMatch[1] !== '-') {
        const index = Number(relMatch[1]);
        if (index >= relations.length)
          throw new AdoError(
            400,
            `The relation at index ${index} does not exist.`,
            'VssPropertyValidationException',
          );
        relations.splice(index, 1);
        continue;
      }
      throw new AdoError(
        400,
        `The operation ${op} on ${path} is not supported.`,
        'VssPropertyValidationException',
      );
    }
    throw new AdoError(400, `The path ${path} is not supported.`, 'VssPropertyValidationException');
  }

  // Rules of every type.
  const title = String(fields['System.Title'] ?? '').trim();
  if (!title) throw ruleError('Title', 'Required, InvalidEmpty');
  if (!fields['System.State']) fields['System.State'] = def.states[0]![0];
  if (!fields['System.AreaPath']) fields['System.AreaPath'] = opts.project.name;
  if (!fields['System.IterationPath']) fields['System.IterationPath'] = opts.project.name;

  const at = stamp(before ? (before.fields['System.ChangedDate'] as string) : null);
  const changes: WriteResult['changes'] = {};
  const touched: WriteResult['touched'] = [];
  let item: WorkItemState;
  if (!existing) {
    const id = state.nextWorkItemId++;
    item = { id, projectId: opts.project.id, deleted: false, revisions: [], comments: [] };
    const f: Record<string, unknown> = {
      ...fields,
      'System.Id': id,
      'System.Rev': 1,
      'System.TeamProject': opts.project.name,
      'System.WorkItemType': def.name,
      'System.Reason': 'New',
      'System.CreatedDate': at,
      'System.CreatedBy': { $identity: opts.by },
      'System.ChangedDate': at,
      'System.ChangedBy': { $identity: opts.by },
      'System.CommentCount': 0,
      'Microsoft.VSTS.Common.StateChangeDate': at,
    };
    if (
      def.fields.includes('Microsoft.VSTS.Common.Priority') &&
      f['Microsoft.VSTS.Common.Priority'] === undefined
    )
      f['Microsoft.VSTS.Common.Priority'] = 2;
    const parent = relations.find((r) => r.rel === HIERARCHY_REVERSE);
    if (parent?.target) f['System.Parent'] = parent.target;
    item.revisions.push({ rev: 1, fields: f, relations });
    state.workItems[String(id)] = item;
    for (const [k, v] of Object.entries(f)) changes[k] = { newValue: v };
  } else {
    item = existing;
    const prev = before!;
    for (const key of new Set([...Object.keys(prev.fields), ...Object.keys(fields)])) {
      if (SERVER_FIELDS.has(key)) continue;
      if (JSON.stringify(prev.fields[key]) !== JSON.stringify(fields[key]))
        changes[key] = { oldValue: prev.fields[key], newValue: fields[key] };
    }
    const relChanged = JSON.stringify(prev.relations) !== JSON.stringify(relations);
    if (!Object.keys(changes).length && !relChanged && history === null)
      return { item, changed: false, changes, touched };
    if (changes['System.State']) {
      fields['System.Reason'] = `Moved to ${String(fields['System.State'])}`;
      fields['Microsoft.VSTS.Common.StateChangeDate'] = at;
    }
    appendRevision(item, fields, relations, opts.by, at);
  }
  if (history !== null) {
    const rev = current(item);
    item.comments.push({
      id: item.comments.reduce((m, c) => Math.max(m, c.id), 0) + 1,
      rev: rev.rev,
      text: history,
      format: 'html',
      createdBy: opts.by,
      createdDate: at,
      modifiedDate: at,
      isDeleted: false,
    });
    rev.fields['System.History'] = history;
    rev.fields['System.CommentCount'] = item.comments.filter((c) => !c.isDeleted).length;
    changes['System.History'] = { newValue: history };
  }

  // The other end of hierarchy links that were added or removed.
  const prevParent = before?.relations.find((r) => r.rel === HIERARCHY_REVERSE)?.target;
  const nextParent = relations.find((r) => r.rel === HIERARCHY_REVERSE)?.target;
  if (prevParent !== nextParent) {
    if (prevParent !== undefined) {
      const p = state.workItems[String(prevParent)];
      if (p) {
        const cur = current(p);
        appendRevision(
          p,
          { ...cur.fields },
          cur.relations.filter((r) => !(r.rel === HIERARCHY_FORWARD && r.target === item.id)),
          opts.by,
          stamp(cur.fields['System.ChangedDate'] as string),
        );
        touched.push({ item: p, changes: {} });
      }
    }
    if (nextParent !== undefined) {
      const p = state.workItems[String(nextParent)]!;
      const cur = current(p);
      appendRevision(
        p,
        { ...cur.fields },
        [
          ...cur.relations,
          { rel: HIERARCHY_FORWARD, target: item.id, attributes: { isLocked: false, name: 'Child' } },
        ],
        opts.by,
        stamp(cur.fields['System.ChangedDate'] as string),
      );
      touched.push({ item: p, changes: {} });
    }
  }
  return { item, changed: true, changes, touched };
}

/* ───────────────────────────── comments ───────────────────────────── */

/** A comment as the Comments API returns it (`format` and `renderedText` only from 7.1). */
export function serializeComment(
  state: AdoState,
  urls: Urls,
  item: WorkItemState,
  c: WorkItemState['comments'][number],
  v71 = false,
) {
  const project = projectOf(state, item);
  return {
    mentions: [],
    workItemId: item.id,
    id: c.id,
    version: 1,
    text: c.text,
    createdBy: identityRef(state, urls, c.createdBy),
    createdDate: c.createdDate,
    modifiedBy: identityRef(state, urls, c.createdBy),
    modifiedDate: c.modifiedDate,
    isDeleted: c.isDeleted,
    ...(v71
      ? {
          format: c.format ?? 'html',
          renderedText:
            c.format === 'markdown'
              ? `<p>${c.text.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x]!)}</p>`
              : c.text,
        }
      : {}),
    url: `${urls.api}/${project.id}/_apis/wit/workItems/${item.id}/comments/${c.id}`,
  };
}

/** Adds a comment (a new revision with the comment count), as the discussion does. */
export function addComment(
  state: AdoState,
  item: WorkItemState,
  text: string,
  by: string,
  format: 'html' | 'markdown' = 'html',
) {
  if (!text.trim())
    throw new AdoError(400, 'The comment text cannot be empty.', 'VssPropertyValidationException');
  const cur = current(item);
  const at = stamp(cur.fields['System.ChangedDate'] as string);
  const comment = {
    id: item.comments.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    rev: cur.rev + 1,
    text,
    format,
    createdBy: by,
    createdDate: at,
    modifiedDate: at,
    isDeleted: false,
  };
  item.comments.push(comment);
  const rev = appendRevision(
    item,
    { ...cur.fields, 'System.CommentCount': item.comments.filter((c) => !c.isDeleted).length },
    cur.relations,
    by,
    at,
  );
  // The discussion entry shows in the revision's history (and in the `workitem.commented` hook).
  rev.fields['System.History'] = text;
  return comment;
}
