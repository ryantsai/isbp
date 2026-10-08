import { customFields, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type CustomFieldService,
  type Db,
  ErrorCodes,
  evaluateCondition,
  expandRowFields,
  type FieldDef,
  type FieldError,
  formatRecordRef,
  HttpError,
  parseRecordRef,
  type RecordRef,
  validateFields,
} from '@isbp/sdk/server';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { currentAuth } from './context';
import type { ModuleRegistry } from './modules';

const TTL_MS = 10_000;

type RecordFacts = (refs: readonly RecordRef[]) => Promise<Map<string, Record<string, unknown>>>;
/** Refs (`type:id`) the person may read, or that exist when there is no person (see `RecordRegistry.readable`). */
type ReadableRecords = (refs: readonly RecordRef[], auth: AuthContext | null) => Promise<Set<string>>;

/** Refs picked in a `record` field (one or a list), parsed; malformed entries are dropped. */
function pickedRefs(raw: unknown): RecordRef[] {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (v): v is string => typeof v === 'string',
  );
  return list
    .map(parseRecordRef)
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(({ type, id }) => ({ type, id }));
}

/**
 * Approval facts of the records picked in `record` fields, by field key: the record's facts, or a list of them for
 * multi-pick fields (conditions such as `eq` match any element). Fields without a facts-providing type are skipped.
 */
export async function recordFieldFacts(
  fields: readonly FieldDef[],
  values: Record<string, unknown>,
  facts: RecordFacts,
): Promise<Record<string, unknown>> {
  const picked = fields
    .filter((f) => f.type === 'record')
    .map((f) => {
      const raw = values[f.key];
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
        (v): v is string => typeof v === 'string',
      );
      return { f, refs: list.map(parseRecordRef).filter((r): r is NonNullable<typeof r> => r !== null) };
    })
    .filter((p) => p.refs.length);
  if (!picked.length) return {};
  const all = await facts(picked.flatMap((p) => p.refs.map(({ type, id }) => ({ type, id }))));
  const out: Record<string, unknown> = {};
  for (const { f, refs } of picked) {
    const found = refs.map((r) => all.get(`${r.type}:${r.id}`)).filter((x) => x !== undefined);
    if (!found.length) continue;
    out[f.key] = f.record?.multiple ? listFacts(found) : found[0];
  }
  return out;
}

/** Facts of several records as one object of lists (`{ criticality: ['high', 'low'] }`) for conditions. */
function listFacts(items: Record<string, unknown>[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const item of items)
    for (const [k, v] of Object.entries(item)) (out[k] ??= []).push(...(Array.isArray(v) ? v : [v]));
  return out;
}

export interface FieldIssue {
  path: string;
  message: string;
  code: FieldError['code'];
  params?: FieldError['params'];
  /** A form rule's own message (code `rule`), in the form's languages. */
  text?: FieldError['message'];
}

/** Turns field errors into the standard `VALIDATION_FAILED` error (paths under `prefix`; form rules on `_form`). */
export function fieldValidationError(errors: Record<string, FieldError>, prefix: string): HttpError {
  const issues: FieldIssue[] = Object.entries(errors).map(([key, e]) => ({
    path: prefix ? `${prefix}.${key}` : key,
    message: e.code,
    code: e.code,
    params: e.params,
    ...(e.message ? { text: e.message } : {}),
  }));
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Some fields are invalid', { issues });
}

/**
 * Checks the records picked in `record` fields (values already shape-checked by `validateFields`): each must exist
 * and be readable by the person (`auth`; without one, existence only), and match the field's `where` on the record's
 * facts. Otherwise the field gets the `record` error, so a hand-made request can't pick what the picker won't offer.
 */
export async function verifyRecordFields(
  records: { readable: ReadableRecords; facts: RecordFacts },
  fields: readonly FieldDef[],
  values: Record<string, unknown>,
  auth: AuthContext | null,
  existing: Record<string, unknown> = {},
): Promise<Record<string, FieldError>> {
  // Table cells are checked like fields of their own (errors on `<table>.<row>.<column>`).
  const flat = expandRowFields(fields, values);
  const before = expandRowFields(fields, existing);
  /** What a field (or a table column, in any row: rows may move) held before. */
  const stored = (key: string): unknown => {
    const cell = /^(.+)\.\d+\.([^.]+)$/.exec(key);
    if (!cell) return existing[key];
    return Object.entries(before.values)
      .filter(([k]) => k.startsWith(`${cell[1]}.`) && k.endsWith(`.${cell[2]}`))
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
  };
  const picked = flat.fields
    .filter((f) => f.type === 'record')
    .map((f) => {
      // Records already stored in the field were checked when they were picked (perhaps by someone else).
      const kept = new Set(pickedRefs(stored(f.key)).map(formatRecordRef));
      const raw = flat.values[f.key];
      const pending = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((v) => !kept.has(String(v)));
      return { f, refs: pickedRefs(pending), pending: pending.length };
    })
    .filter((p) => p.pending);
  if (!picked.length) return {};
  const all = picked.flatMap((p) => p.refs);
  const filtered = picked.some((p) => p.f.record?.where);
  const [readable, facts] = await Promise.all([
    records.readable(all, auth),
    filtered ? records.facts(all) : Promise.resolve(new Map<string, Record<string, unknown>>()),
  ]);
  const errors: Record<string, FieldError> = {};
  for (const { f, refs, pending } of picked) {
    const ok = refs.every((r) => {
      const key = formatRecordRef(r);
      if (!readable.has(key)) return false;
      return !f.record?.where || evaluateCondition(f.record.where, facts.get(key) ?? {});
    });
    // `refs.length < pending`: a value that didn't parse as a record reference.
    if (!ok || refs.length !== pending) errors[f.key] = { code: 'record' };
  }
  return errors;
}

/** Checks that `user` field values reference existing people. */
export async function verifyUserFields(
  db: Db,
  fields: readonly FieldDef[],
  input: Record<string, unknown>,
): Promise<Record<string, FieldError>> {
  // Table cells are checked like fields of their own (errors on `<table>.<row>.<column>`).
  const { fields: all, values } = expandRowFields(fields, input);
  const refs = all.filter((f) => f.type === 'user' && typeof values[f.key] === 'string');
  if (!refs.length) return {};
  const ids = [...new Set(refs.map((f) => values[f.key] as string))];
  const found = new Set(
    (await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((r) => r.id),
  );
  const errors: Record<string, FieldError> = {};
  for (const f of refs) if (!found.has(values[f.key] as string)) errors[f.key] = { code: 'user' };
  return errors;
}

/**
 * Custom-field schema registry: definitions per entity type (cached briefly) and validation of the
 * values stored in each entity's `attributes` JSONB.
 */
export class CustomFieldRegistry {
  private cache = new Map<string, { at: number; defs: FieldDef[] }>();

  /** Wired by the kernel once the record registry exists. */
  recordFacts: RecordFacts = async () => new Map();
  readableRecords: ReadableRecords = async () => new Set();

  constructor(
    private readonly db: Db,
    private readonly registry: ModuleRegistry,
  ) {}

  async facts(entityType: string, attributes: Record<string, unknown> | null | undefined) {
    const values = attributes ?? {};
    const defs = await this.definitions(entityType);
    const active = new Set(defs.map((d) => d.key));
    return {
      attributes: Object.fromEntries(Object.entries(values).filter(([k]) => active.has(k))),
      records: await recordFieldFacts(defs, values, this.recordFacts),
    };
  }

  /** Entity types declared by installed modules (`core.user`, …). */
  entityTypes(): { type: string; moduleId: string; name: string }[] {
    return this.registry.modules.flatMap((m) =>
      (m.manifest.customFields?.entities ?? []).map((e) => ({
        type: `${m.manifest.id}.${e.type}`,
        moduleId: m.manifest.id,
        name: e.name,
      })),
    );
  }

  isEntityType(type: string): boolean {
    return this.entityTypes().some((e) => e.type === type);
  }

  async definitions(entityType: string): Promise<FieldDef[]> {
    const hit = this.cache.get(entityType);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.defs;
    const rows = await this.db
      .select({ field: customFields.field })
      .from(customFields)
      .where(and(eq(customFields.entityType, entityType), isNull(customFields.archivedAt)))
      .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
    const defs = rows.map((r) => r.field);
    this.cache.set(entityType, { at: Date.now(), defs });
    return defs;
  }

  invalidate(entityType?: string) {
    if (entityType) this.cache.delete(entityType);
    else this.cache.clear();
  }

  /**
   * Validates an entity's custom-field values. Records picked in `record` fields must be readable by `auth` (default:
   * the caller of the current request or tool call; without one, they must exist).
   */
  async validate(
    entityType: string,
    input: Record<string, unknown>,
    existing: Record<string, unknown> = {},
    auth?: AuthContext | null,
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions(entityType);
    const result = validateFields(defs, input);
    const [userErrors, recordErrors] = result.ok
      ? await Promise.all([
          verifyUserFields(this.db, defs, result.values),
          verifyRecordFields(
            { readable: this.readableRecords, facts: this.recordFacts },
            defs,
            result.values,
            auth === undefined ? (currentAuth() ?? null) : auth,
            existing,
          ),
        ])
      : [{}, {}];
    const errors = { ...result.errors, ...userErrors, ...recordErrors };
    if (Object.keys(errors).length) throw fieldValidationError(errors, 'attributes');
    const active = new Set(defs.map((d) => d.key));
    // Values of retired (archived) fields are kept; active fields take the submitted values.
    const kept = Object.fromEntries(Object.entries(existing).filter(([k]) => !active.has(k)));
    return { ...kept, ...result.values };
  }

  service(): CustomFieldService {
    return {
      definitions: (t) => this.definitions(t),
      validate: (t, input, existing, auth) => this.validate(t, input, existing, auth),
      facts: (t, attributes) => this.facts(t, attributes),
    };
  }
}
