/**
 * Writing ServiceDesk Plus records the way the real API does: lookups by name or id (unknown ones refused
 * with 4001), technicians must exist, unknown requesters are added, read-only fields refused (4014), unknown
 * fields refused (`EXTRA_KEY_FOUND_IN_JSON`), mandatory fields checked (4012), and the last-update time moved
 * forward on every change.
 */
import {
  dateValue,
  displayId,
  type Named,
  newId,
  type Rec,
  type SdpState,
  type SdpUser,
  timeValue,
} from './data';
import { SdpInputError } from './query';

export type ModuleKey = 'requests' | 'problems' | 'changes' | 'assets' | 'solutions';

type FieldKind =
  | { kind: 'lookup'; list: string; lenient?: boolean }
  | { kind: 'user'; technician?: boolean; addUnknown?: boolean }
  | { kind: 'datetime' }
  | { kind: 'date' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  /** `{ <inner>: html }` */
  | { kind: 'nested'; inner: string };

export interface ModuleDef {
  key: ModuleKey;
  single: 'request' | 'problem' | 'change' | 'asset' | 'solution';
  /** API name (`/api/v3/<api>`) and the key of one record in its bodies. */
  api: string;
  apiSingle: string;
  /** The last-update time attribute, or null when the module's records have none (changes). */
  updated: string | null;
  title: string;
  required: string[];
  fields: Record<string, FieldKind>;
  readOnly: string[];
  /** Left out of list responses (the list view is a summary). */
  detailOnly: string[];
  /** HTML attributes: can't be sorted or searched (build 16000). */
  html: string[];
}

const L = (list: string, lenient = false): FieldKind => ({ kind: 'lookup', list, lenient });
const tech: FieldKind = { kind: 'user', technician: true };
const person: FieldKind = { kind: 'user', addUnknown: true };
const S: FieldKind = { kind: 'string' };
const DT: FieldKind = { kind: 'datetime' };
const D: FieldKind = { kind: 'date' };

const ticketLookups = {
  priority: L('priorities'),
  impact: L('impacts'),
  urgency: L('urgencies'),
  category: L('categories'),
  subcategory: L('subcategories', true),
  group: L('groups'),
};

export const MODULES: Record<ModuleKey, ModuleDef> = {
  requests: {
    key: 'requests',
    single: 'request',
    api: 'requests',
    apiSingle: 'request',
    updated: 'last_updated_time',
    title: 'subject',
    required: ['subject'],
    fields: {
      subject: S,
      description: S,
      request_type: L('request_types'),
      status: L('statuses'),
      mode: L('modes'),
      level: L('levels'),
      ...ticketLookups,
      technician: tech,
      requester: person,
      resolution: { kind: 'nested', inner: 'content' },
      due_by_time: DT,
    },
    readOnly: ['id', 'display_id', 'created_time', 'last_updated_time', 'is_service_request', 'has_notes'],
    detailOnly: ['description', 'resolution', 'impact', 'urgency', 'subcategory', 'mode', 'level'],
    html: ['description', 'resolution'],
  },
  problems: {
    key: 'problems',
    single: 'problem',
    api: 'problems',
    apiSingle: 'problem',
    updated: 'updated_time',
    title: 'title',
    required: ['title'],
    fields: {
      title: S,
      description: S,
      status: L('problem_statuses'),
      ...ticketLookups,
      technician: tech,
      reported_by: person,
      is_known_error: { kind: 'boolean' },
      symptoms: { kind: 'nested', inner: 'symptoms_description' },
      root_cause: { kind: 'nested', inner: 'root_cause_description' },
      workaround_details: { kind: 'nested', inner: 'workaround_details_description' },
      resolution_details: { kind: 'nested', inner: 'resolution_details_description' },
      due_by_time: DT,
    },
    readOnly: ['id', 'display_id', 'reported_time', 'updated_time'],
    detailOnly: ['description', 'symptoms', 'root_cause', 'workaround_details', 'resolution_details'],
    html: ['description', 'symptoms', 'root_cause', 'workaround_details', 'resolution_details'],
  },
  changes: {
    key: 'changes',
    single: 'change',
    api: 'changes',
    apiSingle: 'change',
    // The change API documents no last-update time: the connector has to scan.
    updated: null,
    title: 'title',
    required: ['title'],
    fields: {
      title: S,
      description: S,
      change_type: L('change_types'),
      risk: L('change_risks'),
      reason_for_change: L('reasons_for_change'),
      stage: L('change_stages'),
      status: L('change_statuses'),
      emergency: { kind: 'boolean' },
      priority: L('priorities'),
      impact: L('impacts'),
      urgency: L('urgencies'),
      category: L('categories'),
      group: L('groups'),
      change_owner: tech,
      change_manager: tech,
      change_requester: person,
      scheduled_start_time: DT,
      scheduled_end_time: DT,
      roll_out_plan: { kind: 'nested', inner: 'roll_out_plan_description' },
      back_out_plan: { kind: 'nested', inner: 'back_out_plan_description' },
    },
    readOnly: ['id', 'display_id', 'created_time'],
    detailOnly: ['description', 'roll_out_plan', 'back_out_plan'],
    html: ['description', 'roll_out_plan', 'back_out_plan'],
  },
  assets: {
    key: 'assets',
    single: 'asset',
    // Build 15100's asset API: `asset_assets` (basic fields) plus one API per product type (see TYPE_APIS).
    api: 'asset_assets',
    apiSingle: 'asset_asset',
    updated: 'last_updated_time',
    title: 'name',
    required: ['name'],
    fields: {
      name: S,
      asset_tag: S,
      barcode: S,
      org_serial_number: S,
      product: L('products'),
      product_type: L('product_types'),
      state: L('asset_states'),
      user: { kind: 'user' },
      location: S,
      vendor: L('vendors'),
      purchase_cost: { kind: 'number' },
      acquisition_date: D,
      warranty_expiry: D,
      department: L('departments', true),
    },
    readOnly: ['id', 'created_time', 'last_updated_time', 'ip_address'],
    detailOnly: [],
    html: [],
  },
  solutions: {
    key: 'solutions',
    single: 'solution',
    api: 'solutions',
    apiSingle: 'solution',
    updated: 'last_updated_time',
    title: 'title',
    required: ['title', 'description'],
    fields: {
      title: S,
      description: S,
      topic: L('topics'),
      keywords: S,
      approval_status: L('solution_statuses'),
      is_public: { kind: 'boolean' },
      review_date: D,
      expiry_date: D,
    },
    readOnly: ['id', 'display_id', 'created_time', 'last_updated_time', 'created_by'],
    detailOnly: ['description'],
    html: ['description'],
  },
};

/** `requests`, `request` → the module (test controls accept either). */
/** `requests`, `request`, `asset_assets` → the module (test controls accept any of them). */
export function moduleOf(name: string): ModuleDef | null {
  const byApi = Object.values(MODULES).find((m) => m.api === name);
  if (byApi) return byApi;
  const key = (name.endsWith('s') ? name : `${name}s`) as ModuleKey;
  return MODULES[key] ?? null;
}

/** The module `/api/v3/<api>` serves (the old `/assets` API is gone since build 15100). */
export function moduleByApi(api: string): ModuleDef | null {
  return Object.values(MODULES).find((m) => m.api === api) ?? null;
}

/** Product type APIs (build 15100): the product types each one adds, the first being its default. */
export const TYPE_APIS: Record<string, string[]> = {
  asset_computers: ['Workstation', 'Laptop'],
  asset_servers: ['Server'],
  asset_access_points: ['Access Point'],
  asset_firewalls: ['Firewall'],
  asset_switches: ['Switch'],
  asset_routers: ['Router'],
  asset_printers: ['Printer'],
  asset_smart_phones: ['Smart Phone'],
  asset_tablets: ['Tablet'],
};

/** `asset_computers` → `asset_computer`, `asset_switches` → `asset_switch`. */
export function singularOf(api: string): string {
  if (/(ch|sh|x|ss)es$/.test(api)) return api.slice(0, -2);
  return api.endsWith('s') ? api.slice(0, -1) : api;
}

/** What `asset_assets` reads and writes: the basic fields every product type has. */
export const BASIC_ASSET_FIELDS = [
  'id',
  'name',
  'asset_tag',
  'org_serial_number',
  'product',
  'product_type',
  'state',
  'user',
  'department',
  'created_time',
  'last_updated_time',
];

export function basicView(rec: Rec): Rec {
  return Object.fromEntries(Object.entries(rec).filter(([k]) => BASIC_ASSET_FIELDS.includes(k)));
}

/** Fields `list_info` may sort and search by: the module's own, never HTML ones. */
export function sortable(def: ModuleDef, field: string): boolean {
  const top = field.split('.')[0]!;
  if (def.html.includes(top)) return false;
  if (top === 'id' || top === 'display_id' || top === 'created_time' || top === def.updated) return true;
  return top in def.fields || def.readOnly.includes(top);
}

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function lookup(state: SdpState, list: string, field: string, v: unknown, lenient: boolean): Named | null {
  if (v === null || v === '') return null;
  const ref = isObj(v) ? v : typeof v === 'string' ? { name: v } : null;
  if (!ref) throw new SdpInputError(`Invalid value for ${field}`, 4001, field);
  const items = (state.picklists[list] ??= []);
  const found = items.find(
    (p) =>
      (ref.id !== undefined && String(ref.id) === p.id) ||
      (typeof ref.name === 'string' && p.name.toLowerCase() === ref.name.trim().toLowerCase()),
  );
  if (found)
    return {
      id: found.id,
      name: found.name,
      ...(found.product_type ? { product_type: found.product_type } : {}),
    };
  if (lenient && typeof ref.name === 'string' && ref.name.trim()) {
    const added = { id: newId(state), name: ref.name.trim() };
    items.push(added);
    return added;
  }
  throw new SdpInputError(
    'Id or Name given in Input does not exist or not in use or user cannot set the value',
    4001,
    field,
  );
}

function userRef(u: SdpUser) {
  return { id: u.id, name: u.name, email_id: u.email_id };
}

function resolveUser(
  state: SdpState,
  field: string,
  v: unknown,
  kind: { technician?: boolean; addUnknown?: boolean },
) {
  if (v === null || v === '') return null;
  const ref = isObj(v) ? v : typeof v === 'string' ? (v.includes('@') ? { email_id: v } : { name: v }) : null;
  if (!ref) throw new SdpInputError(`Invalid value for ${field}`, 4001, field);
  const email = typeof ref.email_id === 'string' ? ref.email_id.trim().toLowerCase() : null;
  const found = state.users.find(
    (u) =>
      (ref.id !== undefined && String(ref.id) === u.id) ||
      (email && u.email_id.toLowerCase() === email) ||
      (!email && ref.id === undefined && typeof ref.name === 'string' && u.name === ref.name),
  );
  if (found) {
    if (kind.technician && !found.is_technician)
      throw new SdpInputError(`${found.name} is not a technician`, 4001, field);
    return userRef(found);
  }
  if (kind.addUnknown && email) {
    const added: SdpUser = {
      id: newId(state),
      name: typeof ref.name === 'string' && ref.name.trim() ? ref.name.trim() : email.split('@')[0]!,
      email_id: email,
      is_technician: false,
    };
    state.users.push(added);
    return userRef(added);
  }
  throw new SdpInputError(
    'Id or Name given in Input does not exist or not in use or user cannot set the value',
    4001,
    field,
  );
}

function msOf(field: string, v: unknown): number {
  const raw = isObj(v) ? v.value : v;
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : Date.parse(String(raw));
  if (!Number.isFinite(n)) throw new SdpInputError(`Invalid time for ${field}`, 4021, field);
  return n;
}

/**
 * Applies a request body to `rec` (a copy is the caller's business). Throws {@link SdpInputError} with the
 * status code ServiceDesk Plus would use.
 */
export function applyInput(state: SdpState, def: ModuleDef, rec: Rec, input: Rec): void {
  for (const [field, value] of Object.entries(input)) {
    if (def.readOnly.includes(field)) throw new SdpInputError('Trying to edit read-only field', 4014, field);
    const kind = def.fields[field];
    if (!kind) throw new SdpInputError('EXTRA_KEY_FOUND_IN_JSON', 4000, field);
    switch (kind.kind) {
      case 'lookup':
        rec[field] = lookup(state, kind.list, field, value, Boolean(kind.lenient));
        break;
      case 'user':
        rec[field] = resolveUser(state, field, value, kind);
        break;
      case 'datetime':
        rec[field] = value === null || value === '' ? null : timeValue(msOf(field, value));
        break;
      case 'date':
        rec[field] =
          value === null || value === ''
            ? null
            : dateValue(new Date(msOf(field, value)).toISOString().slice(0, 10));
        break;
      case 'string':
        if (value !== null && typeof value !== 'string' && typeof value !== 'number')
          throw new SdpInputError('Data type mismatch', 4021, field);
        rec[field] = value === null ? null : String(value);
        break;
      case 'number': {
        const n = value === null || value === '' ? null : Number(value);
        if (n !== null && !Number.isFinite(n)) throw new SdpInputError('Data type mismatch', 4021, field);
        rec[field] = n;
        break;
      }
      case 'boolean':
        if (value !== null && typeof value !== 'boolean' && value !== 'true' && value !== 'false')
          throw new SdpInputError('Data type mismatch', 4021, field);
        rec[field] = value === true || value === 'true';
        break;
      case 'nested': {
        const inner = isObj(value) ? value[kind.inner] : value;
        if (inner !== null && inner !== undefined && typeof inner !== 'string')
          throw new SdpInputError('Data type mismatch', 4021, field);
        rec[field] = { ...(isObj(rec[field]) ? rec[field] : {}), [kind.inner]: inner ?? '' };
        break;
      }
    }
  }
}

/**
 * Runs a write all or nothing: a refused body leaves no trace (no display id used up, no requester or
 * picklist value added).
 */
export function atomically<T>(state: SdpState, fn: () => T): T {
  const saved = structuredClone({
    nextId: state.nextId,
    seq: state.seq,
    users: state.users,
    picklists: state.picklists,
  });
  try {
    return fn();
  } catch (err) {
    Object.assign(state, saved);
    throw err;
  }
}

/** Rules ServiceDesk Plus checks across fields, after a body was applied. */
export function validate(def: ModuleDef, rec: Rec): void {
  if (
    def.key === 'solutions' &&
    rec.is_public === true &&
    (rec.approval_status as Named | null)?.name !== 'Approved'
  )
    throw new SdpInputError('Only approved solutions can be public', 4001, 'is_public');
}

/** Moves the record's last-update time forward (strictly, so every change gets a new version). */
export function touch(def: ModuleDef, rec: Rec, at?: number): void {
  if (!def.updated) return;
  const prev = Number((rec[def.updated] as { value?: string } | null)?.value ?? 0);
  rec[def.updated] = timeValue(at ?? Math.max(Date.now(), prev + 1));
}

/** A new record from a request body, with the server-side fields ServiceDesk Plus fills in. */
export function createRecord(
  state: SdpState,
  def: ModuleDef,
  input: Rec,
  by: SdpUser | null,
  at?: number,
): Rec {
  for (const field of def.required)
    if (input[field] === undefined || input[field] === null || input[field] === '')
      throw new SdpInputError('Value for mandatory-field is not provided', 4012, field);
  const now = at ?? Date.now();
  const rec: Rec = { id: newId(state) };
  switch (def.key) {
    case 'requests':
      rec.display_id = String(state.seq.request++);
      rec.status = lookup(state, 'statuses', 'status', 'Open', false);
      rec.request_type = lookup(state, 'request_types', 'request_type', 'Incident', false);
      rec.requester = by && !input.requester ? userRef(by) : null;
      rec.has_notes = false;
      rec.created_time = timeValue(now);
      break;
    case 'problems':
      rec.display_id = displayId('PB-', state.seq.problem++);
      rec.status = lookup(state, 'problem_statuses', 'status', 'Open', false);
      rec.reported_time = timeValue(now);
      break;
    case 'changes':
      rec.display_id = displayId('CH-', state.seq.change++);
      rec.stage = lookup(state, 'change_stages', 'stage', 'Submission', false);
      rec.status = lookup(state, 'change_statuses', 'status', 'Requested', false);
      rec.emergency = false;
      rec.created_time = timeValue(now);
      break;
    case 'assets': {
      state.seq.asset++;
      if (!input.product && !input.product_type)
        throw new SdpInputError('Value for mandatory-field is not provided', 4012, 'product_type');
      rec.state = lookup(state, 'asset_states', 'state', 'In Store', false);
      rec.created_time = timeValue(now);
      break;
    }
    case 'solutions':
      rec.display_id = displayId('SOL-', state.seq.solution++);
      rec.approval_status = lookup(state, 'solution_statuses', 'approval_status', 'UnApproved', false);
      rec.is_public = false;
      rec.keywords = '';
      rec.created_by = by ? userRef(by) : null;
      rec.created_time = timeValue(now);
      break;
  }
  applyInput(state, def, rec, input);
  if (def.key === 'requests')
    rec.is_service_request = (rec.request_type as Named | null)?.name === 'Service Request';
  if (def.key === 'assets') {
    // A product brings its product type (and the other way round, the first product of the type).
    const product = rec.product as Named | null | undefined;
    if (product?.product_type) rec.product_type = product.product_type;
    else if (!product && rec.product_type) {
      const type = rec.product_type as Named;
      const first = state.picklists.products?.find((p) => p.product_type?.id === type.id);
      if (!first) throw new SdpInputError(`No product of type ${type.name}`, 4001, 'product');
      rec.product = { id: first.id, name: first.name };
    }
    if (product) rec.product = { id: product.id, name: product.name };
  }
  validate(def, rec);
  touch(def, rec, now);
  return rec;
}

/** The list view: a summary without the long fields. */
export function listView(def: ModuleDef, rec: Rec): Rec {
  if (!def.detailOnly.length) return rec;
  return Object.fromEntries(Object.entries(rec).filter(([k]) => !def.detailOnly.includes(k)));
}

/**
 * Lenient input for the test controls ("edit as a technician in ServiceDesk Plus"): plain names for lookups,
 * e-mail addresses for people, ISO strings or epoch ms for times.
 */
export function fromControl(def: ModuleDef, input: Rec): Rec {
  const out: Rec = {};
  for (const [field, value] of Object.entries(input)) {
    const kind = def.fields[field];
    if (kind?.kind === 'datetime' && (typeof value === 'string' || typeof value === 'number'))
      out[field] = { value: String(typeof value === 'number' ? value : Date.parse(value)) };
    else if (kind?.kind === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
      out[field] = { value: String(Date.parse(`${value}T00:00:00Z`)) };
    else out[field] = value;
  }
  return out;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** A minimal stand-in for the record's page in the ServiceDesk Plus web UI (text only, escaped). */
export function detailPage(def: ModuleDef, rec: Rec): string {
  const rows = Object.entries(rec)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const shown = isObj(v)
        ? String(v.display_value ?? v.name ?? v.email_id ?? Object.values(v).join(' '))
        : String(v);
      return `<tr><th scope="row">${esc(k)}</th><td>${esc(shown.replace(/<[^>]*>/g, ' '))}</td></tr>`;
    })
    .join('');
  const title = String(rec[def.title] ?? rec.id);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · ServiceDesk Plus (mock)</title></head><body><h1>${esc(title)}</h1><p>ServiceDesk Plus stand-in · ${esc(def.single)} ${esc(String(rec.id))}</p><table>${rows}</table></body></html>`;
}
