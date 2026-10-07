/**
 * The ServiceDesk Plus objects the connector syncs, their field catalogues, and the conversion between
 * ServiceDesk Plus JSON (`{ "status": { "name": "Open" } }`, `{ "value": "1478758440000" }`) and the
 * normalized values the Integrations Hub works with (picklists as names, users as `{ email, name, id }`,
 * times as ISO 8601, dates as `YYYY-MM-DD`, HTML as strings). Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import type { RemoteFieldDef, RemoteUser, SyncFieldType } from '@isbp/sdk/server';
import type { SdpObjectType } from '../contracts';

export type Raw = Record<string, unknown>;

/** How a field's value is stored in ServiceDesk Plus JSON. */
type Kind =
  /** plain string */
  | 'string'
  /** HTML string */
  | 'html'
  /** `{ id, name }` picklist or lookup, normalized to its name */
  | 'name'
  /** `{ id, name, email_id }` */
  | 'user'
  /** `{ value: "<epoch ms>", display_value }` */
  | 'datetime'
  /** `{ value: "<epoch ms of the day>" }` */
  | 'date'
  | 'number'
  | 'boolean'
  /** comma-separated keywords ↔ string[] */
  | 'keywords'
  /** `is_public` boolean ↔ "Public" / "Technicians only" */
  | 'public'
  /** a value the connector adds (the object's type for problems) */
  | 'constant';

export interface FieldSpec {
  /** Normalized key (what mappings use). */
  key: string;
  label: string;
  type: SyncFieldType;
  kind: Kind;
  /** Where the value lives in the ServiceDesk Plus object; defaults to `[key]`. */
  path?: readonly string[];
  /** Read from here when `path` is absent (an older or differently named attribute). */
  altPath?: readonly string[];
  /** Fallback choices when the setup endpoint can't be read (type `choice`). */
  choices?: readonly string[];
  /** Setup endpoint with the portal's own choices, and the key of its list in the response. */
  setup?: { path: string; key: string };
  required?: boolean;
  readOnly?: boolean;
  createOnly?: boolean;
  constant?: string;
  /** Users: also send the name (ServiceDesk Plus adds unknown requesters by name and email). */
  withName?: boolean;
}

export interface ObjectSpec {
  type: SdpObjectType;
  /** API path under `<baseUrl>/api/v3` (lists, reads, updates; creates unless the object says otherwise). */
  path: string;
  /** Key of one record in request and response bodies (`request`). */
  single: string;
  /** Key of the list in list responses (`requests`). */
  plural: string;
  /**
   * The record's last-update time, when the server provides it: the version and the sort and search field of the
   * change feed. Objects whose records come without it are versioned by a hash of their values and fed by a full
   * scan (see `connector.ts`).
   */
  updatedField: string;
  /** The record's page in the web UI, relative to the server root (`WorkOrder.do?woMode=viewWO&woID=42`). */
  page(id: string): string;
  /** Normalized key of the record's title. */
  titleKey: string;
  ref(raw: Raw): string;
  fields: readonly FieldSpec[];
  /** Notes ↔ comments. */
  notes?: { single: string; plural: string };
}

/* ───────────────────────────── default choices (a fresh ServiceDesk Plus installation) ───────────────────────────── */

export const CHOICES = {
  requestStatus: ['Open', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Canceled'],
  problemStatus: ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed'],
  priority: ['Low', 'Normal', 'Medium', 'High'],
  impact: ['Affects User', 'Affects Group', 'Affects Department', 'Affects Business'],
  urgency: ['Low', 'Normal', 'High', 'Urgent'],
  category: ['Access', 'Email', 'Hardware', 'Network', 'Security', 'Software', 'Other'],
  group: ['Service Desk', 'Desktop Support', 'Network', 'Security', 'Database'],
  requestType: ['Incident', 'Service Request'],
  changeType: ['Minor', 'Standard', 'Major', 'Significant', 'Emergency'],
  changeRisk: ['Low', 'Medium', 'High', 'Very High'],
  changeStage: ['Submission', 'Planning', 'CAB Evaluation', 'Implementation', 'Review', 'Close'],
  changeStatus: [
    'Requested',
    'Planning In Progress',
    'Pending Approval',
    'Approved',
    'Rejected',
    'In Progress',
    'Completed',
    'On Hold',
    'Canceled',
  ],
  reasonForChange: ['Upgrade', 'Maintenance', 'Compliance', 'Bug Fix', 'New Requirement'],
  assetState: ['In Use', 'In Store', 'In Repair', 'Expired', 'Disposed'],
  productType: [
    'Laptop',
    'Workstation',
    'Monitor',
    'Server',
    'Switch',
    'Router',
    'Firewall',
    'Access Point',
    'Storage',
    'Printer',
    'Smart Phone',
    'Tablet',
  ],
  topic: [
    'Accounts & Passwords',
    'Network & VPN',
    'Email & Calendar',
    'Printers',
    'Hardware',
    'Software',
    'Security',
  ],
  solutionStatus: ['UnApproved', 'Approved', 'Approval Pending', 'Rejected', 'Expired'],
  visibility: ['Public', 'Technicians only'],
} as const;

const setup = (path: string, key = path.slice(1)) => ({ path, key });

/** Fields requests, problems and changes share. */
const ticketish = {
  priority: {
    key: 'priority',
    label: 'Priority',
    type: 'choice',
    kind: 'name',
    choices: CHOICES.priority,
    setup: setup('/priorities'),
  },
  impact: {
    key: 'impact',
    label: 'Impact',
    type: 'choice',
    kind: 'name',
    choices: CHOICES.impact,
    setup: setup('/impacts'),
  },
  urgency: {
    key: 'urgency',
    label: 'Urgency',
    type: 'choice',
    kind: 'name',
    choices: CHOICES.urgency,
    setup: setup('/urgencies'),
  },
  category: {
    key: 'category',
    label: 'Category',
    type: 'choice',
    kind: 'name',
    choices: CHOICES.category,
    setup: setup('/categories'),
  },
  subcategory: { key: 'subcategory', label: 'Subcategory', type: 'string', kind: 'name' },
  group: {
    key: 'group',
    label: 'Group',
    type: 'choice',
    kind: 'name',
    choices: CHOICES.group,
    setup: setup('/groups'),
  },
  description: { key: 'description', label: 'Description', type: 'html', kind: 'html' },
  createdTime: {
    key: 'created_time',
    label: 'Created time',
    type: 'datetime',
    kind: 'datetime',
    readOnly: true,
  },
} satisfies Record<string, FieldSpec>;

/** `{ display_value: "PB-140", value: "140" }` (problems, changes, solutions) or a plain number (requests). */
function displayId(raw: Raw, prefix: string): string {
  const d = raw.display_id;
  if (d && typeof d === 'object') {
    const o = d as { display_value?: unknown; value?: unknown };
    if (typeof o.display_value === 'string' && o.display_value) return o.display_value;
    if (o.value !== undefined && o.value !== null) return `${prefix}${String(o.value)}`;
  }
  if (typeof d === 'string' || typeof d === 'number') return `${prefix}${d}`;
  return `${prefix}${String(raw.id ?? '')}`;
}

export const OBJECTS: Record<SdpObjectType, ObjectSpec> = {
  request: {
    type: 'request',
    path: '/requests',
    single: 'request',
    plural: 'requests',
    updatedField: 'last_updated_time',
    page: (id) => `WorkOrder.do?woMode=viewWO&woID=${id}`,
    titleKey: 'subject',
    ref: (raw) => {
      const d = raw.display_id;
      return `#${typeof d === 'string' || typeof d === 'number' ? d : String(raw.id ?? '')}`;
    },
    notes: { single: 'request_note', plural: 'notes' },
    fields: [
      { key: 'subject', label: 'Subject', type: 'string', kind: 'string', required: true },
      ticketish.description,
      {
        key: 'request_type',
        label: 'Request type',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.requestType,
        setup: setup('/request_types'),
      },
      {
        key: 'status',
        label: 'Status',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.requestStatus,
        setup: setup('/statuses'),
      },
      ticketish.priority,
      ticketish.impact,
      ticketish.urgency,
      ticketish.category,
      ticketish.subcategory,
      ticketish.group,
      { key: 'technician', label: 'Technician', type: 'user', kind: 'user' },
      { key: 'requester', label: 'Requester', type: 'user', kind: 'user', withName: true },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'html',
        kind: 'html',
        path: ['resolution', 'content'],
      },
      { key: 'due_by_time', label: 'Due by', type: 'datetime', kind: 'datetime' },
      ticketish.createdTime,
    ],
  },
  problem: {
    type: 'problem',
    path: '/problems',
    single: 'problem',
    plural: 'problems',
    // The problem object names it `updated_time` (requests, assets and solutions: `last_updated_time`).
    updatedField: 'updated_time',
    page: (id) => `ProblemDetails.cc?PROBLEMID=${id}`,
    titleKey: 'title',
    ref: (raw) => displayId(raw, 'PB-'),
    fields: [
      {
        key: 'record_type',
        label: 'Record type',
        type: 'choice',
        kind: 'constant',
        constant: 'Problem',
        choices: ['Problem'],
        readOnly: true,
      },
      { key: 'title', label: 'Title', type: 'string', kind: 'string', required: true },
      ticketish.description,
      {
        key: 'status',
        label: 'Status',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.problemStatus,
      },
      ticketish.priority,
      ticketish.impact,
      ticketish.urgency,
      ticketish.category,
      ticketish.subcategory,
      ticketish.group,
      { key: 'technician', label: 'Technician', type: 'user', kind: 'user' },
      { key: 'reported_by', label: 'Reported by', type: 'user', kind: 'user', withName: true },
      { key: 'is_known_error', label: 'Known error', type: 'boolean', kind: 'boolean' },
      {
        key: 'symptoms',
        label: 'Symptoms',
        type: 'html',
        kind: 'html',
        path: ['symptoms', 'symptoms_description'],
      },
      {
        key: 'root_cause',
        label: 'Root cause',
        type: 'html',
        kind: 'html',
        path: ['root_cause', 'root_cause_description'],
      },
      {
        key: 'workaround',
        label: 'Workaround',
        type: 'html',
        kind: 'html',
        path: ['workaround_details', 'workaround_details_description'],
      },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'html',
        kind: 'html',
        path: ['resolution_details', 'resolution_details_description'],
      },
      { key: 'due_by_time', label: 'Due by', type: 'datetime', kind: 'datetime' },
      { key: 'reported_time', label: 'Reported time', type: 'datetime', kind: 'datetime', readOnly: true },
    ],
  },
  change: {
    type: 'change',
    path: '/changes',
    single: 'change',
    plural: 'changes',
    updatedField: 'last_updated_time',
    page: (id) => `ChangeDetails.cc?CHANGEID=${id}`,
    titleKey: 'title',
    ref: (raw) => displayId(raw, 'CH-'),
    fields: [
      { key: 'title', label: 'Title', type: 'string', kind: 'string', required: true },
      ticketish.description,
      {
        key: 'change_type',
        label: 'Change type',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.changeType,
        setup: setup('/change_types'),
      },
      {
        key: 'risk',
        label: 'Risk',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.changeRisk,
        setup: setup('/change_risks'),
      },
      {
        key: 'reason_for_change',
        label: 'Reason for change',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.reasonForChange,
        setup: setup('/reasons_for_change'),
      },
      { key: 'stage', label: 'Stage', type: 'choice', kind: 'name', choices: CHOICES.changeStage },
      { key: 'status', label: 'Status', type: 'choice', kind: 'name', choices: CHOICES.changeStatus },
      { key: 'emergency', label: 'Emergency', type: 'boolean', kind: 'boolean' },
      ticketish.priority,
      ticketish.impact,
      ticketish.urgency,
      ticketish.category,
      ticketish.group,
      { key: 'change_owner', label: 'Change owner', type: 'user', kind: 'user' },
      { key: 'change_manager', label: 'Change manager', type: 'user', kind: 'user' },
      { key: 'change_requester', label: 'Change requester', type: 'user', kind: 'user', withName: true },
      {
        key: 'scheduled_start_time',
        label: 'Scheduled start',
        type: 'datetime',
        kind: 'datetime',
      },
      { key: 'scheduled_end_time', label: 'Scheduled end', type: 'datetime', kind: 'datetime' },
      {
        key: 'roll_out_plan',
        label: 'Roll-out plan',
        type: 'html',
        kind: 'html',
        path: ['roll_out_plan', 'roll_out_plan_description'],
      },
      {
        key: 'back_out_plan',
        label: 'Back-out plan',
        type: 'html',
        kind: 'html',
        path: ['back_out_plan', 'back_out_plan_description'],
      },
      ticketish.createdTime,
    ],
  },
  // Since build 15100 (the old `/assets` API was supported until April 2026): `asset_assets` lists, reads,
  // updates and deletes assets of every product type with their basic fields; the product type's own API
  // (`asset_computers`, `asset_servers`, …) adds them and has the full record. See `connector.ts`.
  asset: {
    type: 'asset',
    path: '/asset_assets',
    single: 'asset_asset',
    plural: 'asset_assets',
    updatedField: 'last_updated_time',
    page: (id) => `AssetDetails.do?assetID=${id}`,
    titleKey: 'name',
    ref: (raw) => {
      const tag = raw.asset_tag;
      return typeof tag === 'string' && tag ? tag : String(raw.name ?? raw.id ?? '');
    },
    fields: [
      { key: 'name', label: 'Name', type: 'string', kind: 'string', required: true },
      { key: 'product', label: 'Product', type: 'string', kind: 'name', createOnly: true },
      {
        key: 'product_type',
        label: 'Product type',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.productType,
        setup: setup('/product_types'),
        createOnly: true,
      },
      {
        // The manufacturer's serial number (`org_serial_number` in the asset API of build 15100).
        key: 'serial_number',
        label: 'Serial number',
        type: 'string',
        kind: 'string',
        path: ['org_serial_number'],
        altPath: ['serial_number'],
      },
      { key: 'asset_tag', label: 'Asset tag', type: 'string', kind: 'string' },
      { key: 'state', label: 'Asset state', type: 'choice', kind: 'name', choices: CHOICES.assetState },
      { key: 'user', label: 'User', type: 'user', kind: 'user' },
      { key: 'location', label: 'Location', type: 'string', kind: 'string' },
      { key: 'vendor', label: 'Vendor', type: 'string', kind: 'name' },
      { key: 'purchase_cost', label: 'Purchase cost', type: 'number', kind: 'number' },
      { key: 'acquisition_date', label: 'Acquisition date', type: 'date', kind: 'date' },
      { key: 'warranty_expiry', label: 'Warranty expiry', type: 'date', kind: 'date' },
      { key: 'ip_address', label: 'IP address', type: 'string', kind: 'string', readOnly: true },
    ],
  },
  solution: {
    type: 'solution',
    path: '/solutions',
    single: 'solution',
    plural: 'solutions',
    updatedField: 'last_updated_time',
    page: (id) => `AddSolution.do?submitaction=viewsolution&solID=${id}`,
    titleKey: 'title',
    ref: (raw) => displayId(raw, 'SOL-'),
    fields: [
      { key: 'title', label: 'Title', type: 'string', kind: 'string', required: true },
      { key: 'description', label: 'Description', type: 'html', kind: 'html', required: true },
      {
        key: 'topic',
        label: 'Topic',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.topic,
        setup: setup('/topics'),
      },
      { key: 'keywords', label: 'Keywords', type: 'tags', kind: 'keywords' },
      {
        key: 'approval_status',
        label: 'Approval status',
        type: 'choice',
        kind: 'name',
        choices: CHOICES.solutionStatus,
      },
      {
        key: 'visibility',
        label: 'Visibility',
        type: 'choice',
        kind: 'public',
        path: ['is_public'],
        choices: CHOICES.visibility,
      },
      { key: 'review_date', label: 'Review date', type: 'date', kind: 'date' },
      { key: 'expiry_date', label: 'Expiry date', type: 'date', kind: 'date' },
      { key: 'created_by', label: 'Created by', type: 'user', kind: 'user', readOnly: true },
    ],
  },
};

export function objectSpec(type: string): ObjectSpec | null {
  return (OBJECTS as Record<string, ObjectSpec>)[type] ?? null;
}

/* ───────────────────────────── field catalogue ───────────────────────────── */

/** The catalogue with the given (fetched) choices per field key; static choices otherwise. */
export function fieldDefs(spec: ObjectSpec, fetched: Record<string, string[]> = {}): RemoteFieldDef[] {
  return spec.fields.map((f) => {
    const names = fetched[f.key]?.length ? fetched[f.key]! : f.choices;
    return {
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.type === 'choice' && names ? { choices: names.map((n) => ({ value: n, label: n })) } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.readOnly ? { readOnly: true } : {}),
      ...(f.createOnly ? { createOnly: true } : {}),
    };
  });
}

/* ───────────────────────────── reading (ServiceDesk Plus → normalized) ───────────────────────────── */

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function at(raw: Raw, path: readonly string[]): unknown {
  let v: unknown = raw;
  for (const k of path) {
    if (!isObj(v)) return undefined;
    v = v[k];
  }
  return v;
}

/** Epoch ms of a ServiceDesk Plus time (`{ value: "1478758440000" }`, a number or a numeric string). */
export function epochMs(v: unknown): number | null {
  const raw = isObj(v) ? v.value : v;
  if (raw === null || raw === undefined || raw === '' || raw === 'null') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const HALF_DAY = 12 * 3_600_000;

/**
 * ServiceDesk Plus stores a date as the epoch ms of its midnight in the portal's time zone. Adding 12 h
 * before taking the UTC day gives the intended calendar day for every zone from UTC−12 to UTC+12.
 */
export function dayOf(ms: number): string {
  return new Date(ms + HALF_DAY).toISOString().slice(0, 10);
}

/** Midday UTC of a calendar day: shows as that day in any portal time zone between UTC−11 and UTC+11. */
export function dayToMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 12);
}

function readUser(v: unknown): RemoteUser | null {
  if (!isObj(v)) return null;
  const email = typeof v.email_id === 'string' && v.email_id ? v.email_id : null;
  const name = typeof v.name === 'string' ? v.name : (email ?? '');
  if (!email && !name && !v.id) return null;
  return { email, name, id: v.id === undefined || v.id === null ? null : String(v.id) };
}

function readField(f: FieldSpec, raw: Raw): unknown {
  const path = f.path ?? [f.key];
  const v = f.altPath && !(path[0]! in raw) ? at(raw, f.altPath) : at(raw, path);
  switch (f.kind) {
    case 'constant':
      return f.constant ?? null;
    case 'string':
    case 'html':
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
    case 'name':
      if (isObj(v)) return typeof v.name === 'string' && v.name ? v.name : null;
      return typeof v === 'string' && v ? v : null;
    case 'user':
      return readUser(v);
    case 'datetime': {
      const ms = epochMs(v);
      return ms === null ? null : new Date(ms).toISOString();
    }
    case 'date': {
      const ms = epochMs(v);
      return ms === null ? null : dayOf(ms);
    }
    case 'number': {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return v === null || v === undefined ? null : v === true || v === 'true';
    case 'keywords':
      return typeof v === 'string'
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    case 'public':
      return v === true || v === 'true' ? 'Public' : 'Technicians only';
  }
}

/** Whether the record carries the field at all (a missing attribute is unknown, not empty). */
function present(f: FieldSpec, raw: Raw): boolean {
  if (f.kind === 'constant') return true;
  return (f.path ?? [f.key])[0]! in raw || Boolean(f.altPath && f.altPath[0]! in raw);
}

/**
 * The catalogue fields a record carries, normalized. Fields the server left out (the basic asset view, a field
 * a build doesn't know) are left out too, so a sync never mistakes "not returned" for "cleared".
 */
export function readValues(spec: ObjectSpec, raw: Raw): Record<string, unknown> {
  return Object.fromEntries(
    spec.fields.filter((f) => present(f, raw)).map((f) => [f.key, readField(f, raw)]),
  );
}

/** The record's last-update time in epoch ms, when the server provides one. */
export function updatedMs(spec: ObjectSpec, raw: Raw): number | null {
  return epochMs(raw[spec.updatedField]);
}

/** JSON with sorted keys, so equal values always hash the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Raw)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * A record's version: its last-update time (epoch ms) when the server provides it, else `h:` and a hash of its
 * normalized values (changes, and any object a build returns without an update time). Optimistic concurrency
 * compares either kind the same way: re-read, recompute, compare.
 */
export function versionOf(spec: ObjectSpec, raw: Raw, values: Record<string, unknown>): string {
  const ms = updatedMs(spec, raw);
  if (ms !== null) return String(ms);
  return `h:${createHash('sha256').update(stable(values)).digest('hex').slice(0, 32)}`;
}

/* ───────────────────────────── writing (normalized → ServiceDesk Plus) ───────────────────────────── */

export interface WriteIssue {
  path: string;
  message: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function writeUser(f: FieldSpec, v: unknown): unknown {
  if (v === null) return null;
  if (typeof v === 'string') return v.includes('@') ? { email_id: v } : { name: v };
  if (!isObj(v)) throw new Error('expected a user');
  const email = typeof v.email === 'string' && v.email ? v.email : null;
  const name = typeof v.name === 'string' && v.name ? v.name : null;
  // The email identifies the person on both sides; the remote id is only a fallback.
  if (email) return f.withName && name ? { email_id: email, name } : { email_id: email };
  if (v.id) return { id: String(v.id) };
  if (name) return { name };
  throw new Error('expected a user with an email');
}

function writeField(f: FieldSpec, v: unknown): unknown {
  switch (f.kind) {
    case 'constant':
      throw new Error('read-only');
    case 'string':
    case 'html':
      if (v === null) return f.kind === 'html' ? '' : null;
      if (typeof v !== 'string') throw new Error('expected a string');
      return v;
    case 'name':
      if (v === null) return null;
      if (typeof v !== 'string') throw new Error('expected a name');
      return { name: v };
    case 'user':
      return writeUser(f, v);
    case 'datetime': {
      if (v === null) return null;
      const ms = typeof v === 'string' ? Date.parse(v) : NaN;
      if (Number.isNaN(ms)) throw new Error('expected an ISO date-time');
      return { value: String(ms) };
    }
    case 'date':
      if (v === null) return null;
      if (typeof v !== 'string' || !DAY_RE.test(v)) throw new Error('expected YYYY-MM-DD');
      return { value: String(dayToMs(v)) };
    case 'number':
      if (v === null) return null;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('expected a number');
      return v;
    case 'boolean':
      if (v === null) return false;
      if (typeof v !== 'boolean') throw new Error('expected true or false');
      return v;
    case 'keywords':
      if (v === null) return '';
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string'))
        throw new Error('expected a list of strings');
      return v
        .map((s) => s.replace(/,/g, ' ').trim())
        .filter(Boolean)
        .join(',');
    case 'public':
      if (v !== 'Public' && v !== 'Technicians only') throw new Error('expected Public or Technicians only');
      return v === 'Public';
  }
}

function setAt(target: Raw, path: readonly string[], value: unknown) {
  let o = target;
  for (const k of path.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k] as Raw;
  }
  o[path[path.length - 1]!] = value;
}

/**
 * The ServiceDesk Plus body for normalized `values` (only the fields given). Unknown, read-only and (on
 * update) create-only fields, and values of the wrong shape, are reported as issues instead.
 */
export function toRemote(
  spec: ObjectSpec,
  values: Record<string, unknown>,
  mode: 'create' | 'update',
): { body: Raw; issues: WriteIssue[] } {
  const body: Raw = {};
  const issues: WriteIssue[] = [];
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const f = byKey.get(key);
    if (!f) issues.push({ path: key, message: 'unknown field' });
    else if (f.readOnly || f.kind === 'constant') issues.push({ path: key, message: 'read-only' });
    else if (mode === 'update' && f.createOnly)
      issues.push({ path: key, message: 'can only be set when creating' });
    else {
      try {
        setAt(body, f.path ?? [key], writeField(f, value));
      } catch (err) {
        issues.push({ path: key, message: (err as Error).message });
      }
    }
  }
  if (mode === 'create')
    for (const f of spec.fields)
      if (f.required && (values[f.key] === undefined || values[f.key] === null || values[f.key] === ''))
        issues.push({ path: f.key, message: 'required' });
  return { body, issues };
}

/* ───────────────────────────── notes ───────────────────────────── */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Plain text (or Markdown the hub did not convert) as HTML paragraphs with line breaks, escaped. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/[&<>"']/g, (c) => ESC[c]!).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
