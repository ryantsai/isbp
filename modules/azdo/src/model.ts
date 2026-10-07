/**
 * Pure Azure DevOps Server logic shared by the connector, the settings form and the tests: the field
 * catalogue, value conversions, the change-feed cursor, WIQL text, service hook parsing and the default
 * mappings to ISBP's `projects.*` and `alm.repository` sync entities. No I/O here.
 */
import type { FieldMappingSuggestion, RemoteFieldDef, RemoteUser, SyncFieldType } from '@isbp/sdk/server';
import type { ObjectType } from './contracts';

/* ───────────────────────────── processes ───────────────────────────── */

/** Work item types and their states (in workflow order) of the four system processes. */
export const PROCESSES: Record<'Agile' | 'Scrum' | 'Basic' | 'CMMI', Record<string, string[]>> = {
  Agile: {
    Epic: ['New', 'Active', 'Resolved', 'Closed', 'Removed'],
    Feature: ['New', 'Active', 'Resolved', 'Closed', 'Removed'],
    'User Story': ['New', 'Active', 'Resolved', 'Closed', 'Removed'],
    Task: ['New', 'Active', 'Closed', 'Removed'],
    Bug: ['New', 'Active', 'Resolved', 'Closed'],
    Issue: ['Active', 'Closed'],
  },
  Scrum: {
    Epic: ['New', 'In Progress', 'Done', 'Removed'],
    Feature: ['New', 'In Progress', 'Done', 'Removed'],
    'Product Backlog Item': ['New', 'Approved', 'Committed', 'Done', 'Removed'],
    Task: ['To Do', 'In Progress', 'Done', 'Removed'],
    Bug: ['New', 'Approved', 'Committed', 'Done', 'Removed'],
    Impediment: ['Open', 'Closed'],
  },
  Basic: {
    Epic: ['To Do', 'Doing', 'Done'],
    Issue: ['To Do', 'Doing', 'Done'],
    Task: ['To Do', 'Doing', 'Done'],
  },
  CMMI: {
    Epic: ['Proposed', 'Active', 'Resolved', 'Closed'],
    Feature: ['Proposed', 'Active', 'Resolved', 'Closed'],
    Requirement: ['Proposed', 'Active', 'Resolved', 'Closed'],
    Task: ['Proposed', 'Active', 'Resolved', 'Closed'],
    Bug: ['Proposed', 'Active', 'Resolved', 'Closed'],
    'Change Request': ['Proposed', 'Active', 'Resolved', 'Closed'],
    Issue: ['Proposed', 'Active', 'Resolved', 'Closed'],
    Review: ['Active', 'Resolved', 'Closed'],
    Risk: ['Proposed', 'Active', 'Resolved', 'Closed'],
  },
};

/**
 * Types that aren't planning work (test management, code review, feedback): left out of the type choices.
 * Work items of these types still read and update like any other.
 */
export const HIDDEN_TYPES = new Set([
  'Code Review Request',
  'Code Review Response',
  'Feedback Request',
  'Feedback Response',
  'Shared Steps',
  'Shared Parameter',
  'Test Case',
  'Test Plan',
  'Test Suite',
]);

/* ───────────────────────────── field catalogue ───────────────────────────── */

/** Remote field key of a work item's parent (the `System.LinkTypes.Hierarchy-Reverse` relation). */
export const PARENT_KEY = 'parent';
export const HIERARCHY_REVERSE = 'System.LinkTypes.Hierarchy-Reverse';

export const PRIORITIES = ['1', '2', '3', '4'] as const;

interface CatalogEntry {
  key: string;
  label: string;
  type: SyncFieldType;
  required?: boolean;
  readOnly?: boolean;
  createOnly?: boolean;
  /** Present on every work item type (system fields): listed even when no type in the project names it. */
  always?: boolean;
}

/**
 * The work item fields the connector knows how to convert, with Azure DevOps' own labels. Fields of a
 * project's types that aren't listed here and aren't `System.*`/`Microsoft.*` (custom fields such as
 * `Custom.CostCenter`) are added from the collection's field definitions.
 */
export const WORK_ITEM_FIELDS: readonly CatalogEntry[] = [
  { key: 'System.Title', label: 'Title', type: 'string', required: true, always: true },
  {
    key: 'System.WorkItemType',
    label: 'Work Item Type',
    type: 'choice',
    required: true,
    createOnly: true,
    always: true,
  },
  { key: 'System.State', label: 'State', type: 'choice', always: true },
  { key: 'System.AssignedTo', label: 'Assigned To', type: 'user', always: true },
  { key: 'System.Description', label: 'Description', type: 'html', always: true },
  { key: 'Microsoft.VSTS.TCM.ReproSteps', label: 'Repro Steps', type: 'html' },
  { key: 'Microsoft.VSTS.Common.AcceptanceCriteria', label: 'Acceptance Criteria', type: 'html' },
  { key: 'Microsoft.VSTS.Common.Priority', label: 'Priority', type: 'choice' },
  { key: 'System.Tags', label: 'Tags', type: 'tags', always: true },
  { key: 'Microsoft.VSTS.Scheduling.OriginalEstimate', label: 'Original Estimate', type: 'number' },
  { key: 'Microsoft.VSTS.Scheduling.RemainingWork', label: 'Remaining Work', type: 'number' },
  { key: 'Microsoft.VSTS.Scheduling.CompletedWork', label: 'Completed Work', type: 'number' },
  { key: 'Microsoft.VSTS.Scheduling.StoryPoints', label: 'Story Points', type: 'number' },
  { key: 'Microsoft.VSTS.Scheduling.Effort', label: 'Effort', type: 'number' },
  { key: 'Microsoft.VSTS.Scheduling.StartDate', label: 'Start Date', type: 'date' },
  { key: 'Microsoft.VSTS.Scheduling.TargetDate', label: 'Target Date', type: 'date' },
  { key: 'Microsoft.VSTS.Scheduling.FinishDate', label: 'Finish Date', type: 'date' },
  { key: 'Microsoft.VSTS.Scheduling.DueDate', label: 'Due Date', type: 'date' },
  { key: 'Microsoft.VSTS.Common.Activity', label: 'Activity', type: 'string' },
  { key: 'System.IterationPath', label: 'Iteration Path', type: 'string', always: true },
  { key: 'System.AreaPath', label: 'Area Path', type: 'string', always: true },
  { key: PARENT_KEY, label: 'Parent', type: 'parent', always: true },
  { key: 'System.CreatedBy', label: 'Created By', type: 'user', readOnly: true, always: true },
  { key: 'System.CreatedDate', label: 'Created Date', type: 'datetime', readOnly: true, always: true },
  { key: 'System.ChangedDate', label: 'Changed Date', type: 'datetime', readOnly: true, always: true },
];

const CATALOG = new Map(WORK_ITEM_FIELDS.map((f) => [f.key, f]));
export const catalogEntry = (key: string) => CATALOG.get(key);

/** A field the connector adds from the collection's definitions (not a system or Microsoft field). */
export const isCustomField = (key: string) =>
  !CATALOG.has(key) && !key.startsWith('System.') && !key.startsWith('Microsoft.');

/** `_apis/wit/fields` type → sync field type; null for types the connector doesn't sync. */
export function customFieldType(def: { type?: string; isIdentity?: boolean }): SyncFieldType | null {
  if (def.isIdentity) return 'user';
  switch (def.type) {
    case 'string':
    case 'treePath':
    case 'picklistString':
      return 'string';
    case 'plainText':
      return 'text';
    case 'html':
      return 'html';
    case 'integer':
    case 'double':
    case 'picklistInteger':
    case 'picklistDouble':
      return 'number';
    case 'dateTime':
      return 'datetime';
    case 'boolean':
      return 'boolean';
    case 'identity':
      return 'user';
    default:
      return null;
  }
}

export interface ProjectTypeInfo {
  name: string;
  states: string[];
  /** Reference names of the fields on the type. */
  fields: string[];
}

/**
 * The work item catalogue of one team project: the known fields its types use, plus custom fields, with
 * the project's types and the union of their states as choices. Without types (no project chosen yet), the
 * catalogue of the four system processes.
 */
export function workItemCatalog(
  types: ProjectTypeInfo[] | null,
  custom: { key: string; label: string; type: SyncFieldType }[] = [],
): RemoteFieldDef[] {
  const list = types ?? standardTypes();
  const visible = list.filter((t) => !HIDDEN_TYPES.has(t.name));
  const present = types ? new Set(types.flatMap((t) => t.fields)) : null;
  const states = unique(visible.flatMap((t) => t.states));
  const fields: RemoteFieldDef[] = [];
  for (const f of WORK_ITEM_FIELDS) {
    if (present && !f.always && !present.has(f.key)) continue;
    const def: RemoteFieldDef = { key: f.key, label: f.label, type: f.type };
    if (f.required) def.required = true;
    if (f.readOnly) def.readOnly = true;
    if (f.createOnly) def.createOnly = true;
    if (f.key === 'System.WorkItemType') def.choices = visible.map((t) => ({ value: t.name, label: t.name }));
    if (f.key === 'System.State') def.choices = states.map((s) => ({ value: s, label: s }));
    if (f.key === 'Microsoft.VSTS.Common.Priority')
      def.choices = PRIORITIES.map((p) => ({ value: p, label: p }));
    fields.push(def);
  }
  for (const c of custom) if (!CATALOG.has(c.key)) fields.push({ key: c.key, label: c.label, type: c.type });
  return fields;
}

function standardTypes(): ProjectTypeInfo[] {
  const byName = new Map<string, string[]>();
  for (const types of Object.values(PROCESSES))
    for (const [name, states] of Object.entries(types))
      byName.set(name, unique([...(byName.get(name) ?? []), ...states]));
  return [...byName].map(([name, states]) => ({ name, states, fields: [] }));
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

export const PROJECT_FIELDS: RemoteFieldDef[] = [
  { key: 'name', label: 'Name', type: 'string', readOnly: true },
  { key: 'description', label: 'Description', type: 'text', readOnly: true },
  {
    key: 'state',
    label: 'State',
    type: 'choice',
    readOnly: true,
    choices: ['wellFormed', 'createPending', 'deleting', 'new', 'unchanged'].map((s) => ({
      value: s,
      label: s,
    })),
  },
  {
    key: 'visibility',
    label: 'Visibility',
    type: 'choice',
    readOnly: true,
    choices: ['private', 'public'].map((s) => ({ value: s, label: s })),
  },
  { key: 'lastUpdateTime', label: 'Last Update Time', type: 'datetime', readOnly: true },
];

export const REPOSITORY_FIELDS: RemoteFieldDef[] = [
  { key: 'name', label: 'Name', type: 'string', readOnly: true },
  { key: 'url', label: 'Web URL', type: 'string', readOnly: true },
  {
    key: 'provider',
    label: 'Provider',
    type: 'choice',
    readOnly: true,
    choices: [{ value: 'azure_devops', label: 'Azure DevOps' }],
  },
  { key: 'defaultBranch', label: 'Default Branch', type: 'string', readOnly: true },
  { key: 'lastCommitSha', label: 'Last Commit', type: 'string', readOnly: true },
  { key: 'lastCommitAt', label: 'Last Commit Date', type: 'datetime', readOnly: true },
  { key: 'lastCommitMessage', label: 'Last Commit Message', type: 'text', readOnly: true },
  { key: 'lastCommitAuthor', label: 'Last Commit Author', type: 'string', readOnly: true },
  { key: 'branches', label: 'Branches', type: 'json', readOnly: true },
  { key: 'pullRequests', label: 'Active Pull Requests', type: 'json', readOnly: true },
];

/* ───────────────────────────── value conversions ───────────────────────────── */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * A date-only field (Start Date, Target Date) as `YYYY-MM-DD`. Azure DevOps stores them as date-times at
 * midnight in the time zone of whoever set them (`2026-10-14T16:00:00Z` is 15 October in Taipei), so the value
 * rounds to the nearest UTC midnight: right for every zone within ±12 hours.
 */
export function toDay(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (DAY_RE.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(Math.round(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → the date-time Azure DevOps stores (midnight UTC). */
export const fromDay = (day: string) => `${day}T00:00:00.000Z`;

/** `System.Tags` (`"wifi; taipei"`) → `["wifi", "taipei"]`. */
export function splitTags(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return unique(
    value
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

/** Tags → `"a; b"`; an empty list clears the field. */
export const joinTags = (tags: unknown): string =>
  Array.isArray(tags)
    ? unique(tags.map((t) => String(t).replace(/;/g, ',').trim()).filter(Boolean)).join('; ')
    : '';

/** An identity reference (`System.AssignedTo`) as the hub's remote user; email filled in by the caller. */
export interface IdentityRef {
  displayName?: string;
  uniqueName?: string;
  id?: string;
  descriptor?: string;
}

export const isIdentityRef = (v: unknown): v is IdentityRef =>
  typeof v === 'object' && v !== null && ('uniqueName' in v || 'displayName' in v);

/**
 * An identity written as text (`Display Name <DOMAIN\\alias>`, a unique name or a display name), as older API
 * versions and service hooks send it.
 */
export function parseIdentityString(value: string): IdentityRef | null {
  const text = value.trim();
  if (!text) return null;
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  if (m) return { displayName: m[1]!.trim() || m[2]!.trim(), uniqueName: m[2]!.trim() };
  return /[\\@]/.test(text) ? { displayName: text, uniqueName: text } : { displayName: text };
}

/** The email in an identity's unique name, when it is one (`jdoe@contoso.com`, not `CONTOSO\jdoe`). */
export function emailOf(uniqueName: string | undefined | null): string | null {
  if (!uniqueName) return null;
  const v = uniqueName.trim();
  return /^[^\s@\\]+@[^\s@\\]+\.[^\s@\\]+$/.test(v) ? v.toLowerCase() : null;
}

/**
 * What to write into an identity field: an email when known (the server resolves it), else the unique name
 * (`CONTOSO\jdoe`, the remote user's `id`) or the display name. Accepts the hub's remote user, an email or
 * a name; null clears the field.
 */
export function identityValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    const u = value as Partial<RemoteUser>;
    return u.email?.trim() || u.id?.trim() || u.name?.trim() || null;
  }
  return null;
}

/* ───────────────────────────── cursors ───────────────────────────── */

/** Change-feed position: the last record's change time and id. Equal timestamps continue by id. */
export interface FeedCursor {
  at: string;
  id: string;
}

export const encodeCursor = (c: FeedCursor) => `${c.at}|${c.id}`;

export function decodeCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw) return null;
  const i = raw.lastIndexOf('|');
  if (i <= 0) return null;
  const at = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (Number.isNaN(Date.parse(at)) || !id) return null;
  return { at: new Date(at).toISOString(), id };
}

/** Compares (time, id) positions: ids compare numerically when both are numbers (work item ids). */
export function compareFeed(a: FeedCursor, b: FeedCursor): number {
  const t = Date.parse(a.at) - Date.parse(b.at);
  if (t !== 0) return t;
  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ───────────────────────────── WIQL ───────────────────────────── */

/**
 * The change feed query of a team project (run against `{project}/_apis/wit/wiql` with `timePrecision=true`):
 * work items changed after the cursor, oldest first, ties broken by id so equal timestamps neither skip nor
 * repeat. `@project` is the project in the URL, so no name is quoted into the text; the cursor's time is a
 * normalised ISO string and its id an integer.
 */
export function changesWiql(cursor: FeedCursor | null): string {
  const base = 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project';
  const order = 'ORDER BY [System.ChangedDate] ASC, [System.Id] ASC';
  if (!cursor) return `${base} ${order}`;
  const at = new Date(cursor.at).toISOString();
  if (!/^\d{1,10}$/.test(cursor.id)) throw new Error('Invalid cursor id');
  const id = Number(cursor.id);
  return `${base} AND ([System.ChangedDate] > '${at}' OR ([System.ChangedDate] = '${at}' AND [System.Id] > ${id})) ${order}`;
}

/* ───────────────────────────── text ───────────────────────────── */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Plain text as the HTML of a comment: escaped, paragraphs and line breaks kept. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/* ───────────────────────────── service hooks ───────────────────────────── */

export interface HookTarget {
  objectType: ObjectType;
  id: string;
  scope?: string | null;
}

const WORK_ITEM_EVENTS = new Set([
  'workitem.created',
  'workitem.updated',
  'workitem.deleted',
  'workitem.restored',
  'workitem.commented',
]);
const REPOSITORY_EVENTS = new Set([
  'git.push',
  'git.pullrequest.created',
  'git.pullrequest.updated',
  'git.pullrequest.merged',
  // The id some Server 2019 documentation gives the "merge attempted" event.
  'git.pullrequest.merge.attempted',
]);
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const guid = (v: unknown): string | null =>
  typeof v === 'string' && GUID_RE.test(v) ? v.toLowerCase() : null;

const workItemId = (v: unknown): string | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? String(n) : null;
};

/**
 * Which record a service hook ("Web Hooks" consumer) notification is about. Only ids are read, and checked:
 * the hub re-reads the record through the API, so a forged body can at most cause a harmless re-read.
 */
export function parseServiceHook(body: unknown): HookTarget[] {
  const b = record(body);
  if (!b || typeof b.eventType !== 'string') return [];
  const resource = record(b.resource);
  if (!resource) return [];
  const containers = record(b.resourceContainers);
  const project = guid(record(containers?.project)?.id);
  if (WORK_ITEM_EVENTS.has(b.eventType)) {
    // `workitem.updated` carries the update: its `id` is the update's, `workItemId` (and `revision.id`) the
    // work item's. The other events carry the work item itself.
    const id =
      workItemId(resource.workItemId) ??
      workItemId(record(resource.revision)?.id) ??
      (b.eventType === 'workitem.updated' ? null : workItemId(resource.id));
    return id ? [{ objectType: 'work-item', id, scope: project }] : [];
  }
  if (REPOSITORY_EVENTS.has(b.eventType)) {
    const repo = record(resource.repository);
    const id = guid(repo?.id);
    const scope = guid(record(repo?.project)?.id) ?? project;
    return id ? [{ objectType: 'repository', id, scope }] : [];
  }
  return [];
}

/* ───────────────────────────── default mappings ───────────────────────────── */

/** Work item type → ISBP task type. Agile first: pushing a new task picks the first matching remote value. */
/**
 * Value maps cover every process template (Agile first, then Scrum, Basic and CMMI). Rows of the Agile
 * process go both ways; the others are `pull` (into ISBP only), so each ISBP value goes out through one row.
 * The hub fits the map to the scope's live catalogue: rows naming values the project's process doesn't have are
 * dropped, and the first remaining row of a value whose way out was dropped goes both ways.
 */
type ValueRow = { remote: string; local: string; direction?: 'pull' };

export const TYPE_VALUES: ValueRow[] = [
  { remote: 'Epic', local: 'epic' },
  { remote: 'Feature', local: 'feature' },
  { remote: 'User Story', local: 'story' },
  { remote: 'Task', local: 'task' },
  { remote: 'Bug', local: 'bug' },
  { remote: 'Product Backlog Item', local: 'story', direction: 'pull' },
  { remote: 'Issue', local: 'story', direction: 'pull' },
  { remote: 'Requirement', local: 'story', direction: 'pull' },
];

/** State → ISBP task status. Each remote state appears once. */
export const STATE_VALUES: ValueRow[] = [
  { remote: 'New', local: 'todo' },
  { remote: 'Active', local: 'in_progress' },
  { remote: 'Resolved', local: 'in_review' },
  { remote: 'Closed', local: 'done' },
  { remote: 'Removed', local: 'cancelled' },
  { remote: 'Approved', local: 'todo', direction: 'pull' },
  { remote: 'Committed', local: 'in_progress', direction: 'pull' },
  { remote: 'In Progress', local: 'in_progress', direction: 'pull' },
  { remote: 'Done', local: 'done', direction: 'pull' },
  { remote: 'To Do', local: 'todo', direction: 'pull' },
  { remote: 'Doing', local: 'in_progress', direction: 'pull' },
  { remote: 'Proposed', local: 'backlog', direction: 'pull' },
  { remote: 'Open', local: 'todo', direction: 'pull' },
];

export const PRIORITY_VALUES: { remote: string; local: string }[] = [
  { remote: '1', local: 'urgent' },
  { remote: '2', local: 'high' },
  { remote: '3', local: 'medium' },
  { remote: '4', local: 'low' },
];

const pull = (local: string, remote: string): FieldMappingSuggestion => ({
  local,
  remote,
  direction: 'pull',
});
const both = (local: string, remote: string, values?: ValueRow[]): FieldMappingSuggestion =>
  values ? { local, remote, direction: 'both', values } : { local, remote, direction: 'both' };

/**
 * Suggested mappings between the connector's objects and ISBP sync entities (field keys of the adapters in
 * `projects` and `alm`). Iterations aren't mapped to milestones by default: the value map is per project.
 */
export function defaultMapping(objectType: string, entity: string): FieldMappingSuggestion[] {
  if (objectType === 'project' && entity === 'projects.project')
    return [pull('name', 'name'), pull('description', 'description')];
  if (objectType === 'work-item' && entity === 'projects.task')
    return [
      both('type', 'System.WorkItemType', TYPE_VALUES),
      both('title', 'System.Title'),
      both('description', 'System.Description'),
      both('status', 'System.State', STATE_VALUES),
      both('priority', 'Microsoft.VSTS.Common.Priority', PRIORITY_VALUES),
      both('assignee', 'System.AssignedTo'),
      both('parent', PARENT_KEY),
      both('labels', 'System.Tags'),
      both('estimateHours', 'Microsoft.VSTS.Scheduling.OriginalEstimate'),
      both('remainingHours', 'Microsoft.VSTS.Scheduling.RemainingWork'),
      both('startDate', 'Microsoft.VSTS.Scheduling.StartDate'),
      both('dueDate', 'Microsoft.VSTS.Scheduling.TargetDate'),
    ];
  if (objectType === 'repository' && entity === 'alm.repository')
    return REPOSITORY_FIELDS.map((f) => pull(f.key, f.key));
  return [];
}
