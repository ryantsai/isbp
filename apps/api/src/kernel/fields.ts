import { customFields, users } from '@isbp/db/schema';
import {
  type CustomFieldService,
  type Db,
  ErrorCodes,
  type FieldDef,
  type FieldError,
  HttpError,
  validateFields,
} from '@isbp/sdk/server';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { ModuleRegistry } from './modules';

const TTL_MS = 10_000;

export interface FieldIssue {
  path: string;
  message: string;
  code: FieldError['code'];
  params?: FieldError['params'];
}

/** Turns field errors into the standard `VALIDATION_FAILED` error (paths under `prefix`). */
export function fieldValidationError(errors: Record<string, FieldError>, prefix: string): HttpError {
  const issues: FieldIssue[] = Object.entries(errors).map(([key, e]) => ({
    path: prefix ? `${prefix}.${key}` : key,
    message: e.code,
    code: e.code,
    params: e.params,
  }));
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Some fields are invalid', { issues });
}

/** Checks that `user` field values reference existing people. */
export async function verifyUserFields(
  db: Db,
  fields: readonly FieldDef[],
  values: Record<string, unknown>,
): Promise<Record<string, FieldError>> {
  const refs = fields.filter((f) => f.type === 'user' && typeof values[f.key] === 'string');
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

  constructor(
    private readonly db: Db,
    private readonly registry: ModuleRegistry,
  ) {}

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

  async validate(
    entityType: string,
    input: Record<string, unknown>,
    existing: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions(entityType);
    const result = validateFields(defs, input);
    const userErrors = result.ok ? await verifyUserFields(this.db, defs, result.values) : {};
    const errors = { ...result.errors, ...userErrors };
    if (Object.keys(errors).length) throw fieldValidationError(errors, 'attributes');
    const active = new Set(defs.map((d) => d.key));
    // Values of retired (archived) fields are kept; active fields take the submitted values.
    const kept = Object.fromEntries(Object.entries(existing).filter(([k]) => !active.has(k)));
    return { ...kept, ...result.values };
  }

  service(): CustomFieldService {
    return {
      definitions: (t) => this.definitions(t),
      validate: (t, input, existing) => this.validate(t, input, existing),
    };
  }
}
