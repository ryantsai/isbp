import { createCustomFieldSchema } from '@isbp/contracts';
import { customFields } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  type Db,
  type FieldDef,
  fieldDefSchema,
  FIELD_TYPES,
  type FieldType,
  localize,
} from '@isbp/sdk/server';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { getKernel } from '../kernel-ref';
import { CustomFieldAdminService } from '../services/forms';
import {
  catalogLocalized,
  catalogText,
  coreLocalized,
  fieldKeyOf,
  isUuid,
  localeOf,
  matchesQuery,
  optionsOf,
  templateTexts,
  typedText,
} from './shared';

const schema = z.object({
  entityType: createCustomFieldSchema.shape.entityType.describe(
    'Entity whose records get the field, from reference.entities (e.g. core.user). Fixed after creation.',
  ),
  field: fieldDefSchema.describe('The field definition; its key and type are fixed after creation'),
});
export type CustomFieldValue = z.output<typeof schema>;

type FieldRow = typeof customFields.$inferSelect;

async function findField(db: Db, id: string): Promise<FieldRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(customFields).where(eq(customFields.id, id));
  return row ?? null;
}

const entityTypes = () => getKernel().fields.entityTypes();

const INSTRUCTIONS = `A custom field adds a value to every record of an entity type — people, groups, departments and module records that support them (reference.entities) — shown and validated on their edit pages. Value: entityType and field.
field: { key, type, label, help?, placeholder?, required?, options?, validation?, defaultValue?, visibleWhen?, width? ("full" | "half") }. Types: ${FIELD_TYPES.join(', ')}. select and multiselect need options [{ "value", "label" }] with unique values. validation: min/max (numbers; choices for multiselect), minLength/maxLength (text), pattern (text, a simple regular expression). visibleWhen shows the field only when a condition on the record's other custom fields holds.
key starts with a lowercase letter (letters, digits and _), is unique per entity type (reference.entities[].keys, archived fields included) and, like type and entityType, is fixed after creation because stored values depend on it. label, help, placeholder and option labels are LocalizedText: give "en", "zh-TW" and "ja-JP".
Making an existing field required affects every later edit of those records. Archiving hides the field and keeps the stored values.`;

const costCentreExample: CustomFieldValue = {
  entityType: 'core.user',
  field: {
    key: 'costCentre',
    type: 'select',
    label: { en: 'Cost centre', 'zh-TW': '成本中心', 'ja-JP': 'コストセンター' },
    help: {
      en: 'Where this person’s equipment is charged',
      'zh-TW': '此人員設備費用的歸屬',
      'ja-JP': 'この人の機器費用の計上先',
    },
    options: [
      {
        value: 'cc-100',
        label: { en: 'CC-100 Headquarters', 'zh-TW': 'CC-100 總部', 'ja-JP': 'CC-100 本社' },
      },
      { value: 'cc-200', label: { en: 'CC-200 Factory', 'zh-TW': 'CC-200 工廠', 'ja-JP': 'CC-200 工場' } },
    ],
  },
};

const TEMPLATE_TEXTS = ['entityType', 'fieldLabel', 'type', 'required', 'options', 'optionsHelp'] as const;

export const customFieldKind: CustomizationHandler<CustomFieldValue> = {
  /** The field registry was cleared before the commit; clear it again once the field is committed. */
  committed: () => getKernel().fields.invalidate(),

  schema,

  async guide(ctx) {
    const rows = await ctx.db
      .select({ entityType: customFields.entityType, key: customFields.key })
      .from(customFields)
      .orderBy(asc(customFields.entityType), asc(customFields.sortOrder));
    const entities = await Promise.all(
      entityTypes().map(async (e) => ({
        type: e.type,
        module: e.moduleId,
        name: await catalogText(e.name),
        keys: rows.filter((r) => r.entityType === e.type).map((r) => r.key),
      })),
    );
    return {
      instructions: INSTRUCTIONS,
      reference: { entities, fieldTypes: FIELD_TYPES },
      examples: [
        { description: 'A cost centre picked from a list on every person', value: costCentreExample },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx, auth) {
    const rows = await ctx.db
      .select()
      .from(customFields)
      .where(includeArchived ? undefined : isNull(customFields.archivedAt))
      .orderBy(asc(customFields.entityType), asc(customFields.sortOrder), asc(customFields.createdAt));
    const locale = localeOf(auth);
    return rows
      .filter((r) => matchesQuery(q, r.key, r.entityType, ...Object.values(r.field.label)))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        label: localize(r.field.label, locale) || r.key,
        description: `${r.entityType}.${r.key} (${r.field.type})`,
        archived: Boolean(r.archivedAt),
        href: `/admin/custom-fields?entity=${encodeURIComponent(r.entityType)}`,
      }));
  },

  async get(id, ctx, auth) {
    const row = await findField(ctx.db, id);
    if (!row) return null;
    return {
      id: row.id,
      label: localize(row.field.label, localeOf(auth)) || row.key,
      description: `${row.entityType}.${row.key} (${row.field.type})`,
      archived: Boolean(row.archivedAt),
      href: `/admin/custom-fields?entity=${encodeURIComponent(row.entityType)}`,
      value: { entityType: row.entityType, field: row.field },
    };
  },

  async check(change, ctx) {
    if (change.op !== 'create' && change.op !== 'update') return [];
    const v = change.value!;
    const issues: CustomizationIssue[] = [];
    if (!getKernel().fields.isEntityType(v.entityType))
      issues.push({
        path: 'entityType',
        code: 'unknown_entity',
        message: `Unknown entity type "${v.entityType}": use one from reference.entities`,
      });
    if (change.op === 'create') {
      const [{ n }] = (await ctx.db
        .select({ n: count() })
        .from(customFields)
        .where(and(eq(customFields.entityType, v.entityType), eq(customFields.key, v.field.key)))) as [
        { n: number },
      ];
      if (n)
        issues.push({
          path: 'field.key',
          code: 'duplicate_key',
          message: `${v.entityType} already has a field "${v.field.key}" (archived fields keep their key)`,
        });
    } else {
      const row = (await findField(ctx.db, change.id!))!;
      const fixed: [string, string, string][] = [
        ['entityType', row.entityType, v.entityType],
        ['field.key', row.key, v.field.key],
        ['field.type', row.field.type, v.field.type],
      ];
      for (const [path, before, after] of fixed)
        if (before !== after)
          issues.push({
            path,
            code: 'immutable',
            message: `${path} cannot change (it is "${before}"): stored values depend on it`,
          });
    }
    return issues;
  },

  async apply(change, ctx, auth) {
    const svc = new CustomFieldAdminService(ctx);
    const v = change.value;
    switch (change.op) {
      case 'create': {
        const created = await svc.create({ entityType: v!.entityType, field: v!.field }, auth);
        return { id: created.id };
      }
      case 'update': {
        const row = (await findField(ctx.db, change.id!))!;
        if (canonicalJson(row.field) !== canonicalJson(v!.field))
          await svc.update(row.id, { field: v!.field });
        return { id: row.id };
      }
      case 'archive':
      case 'restore':
        await svc.setArchived(change.id!, change.op === 'archive');
        return { id: change.id! };
      default:
        throw new Error(`core.custom-field does not support ${change.op}`);
    }
  },

  templates: [
    {
      id: 'field',
      label: 'core.customizations.field.label',
      description: 'core.customizations.field.description',
      async fields() {
        const t = await templateTexts('field', TEMPLATE_TEXTS);
        const entities = entityTypes();
        const [entityNames, typeNames] = await Promise.all([
          Promise.all(entities.map((e) => catalogLocalized(e.name))),
          Promise.all(FIELD_TYPES.map((type) => coreLocalized(`fields.types.${type}.name`))),
        ]);
        return [
          {
            key: 'entityType',
            type: 'select',
            label: t('entityType'),
            required: true,
            options: entities.map((e, i) => ({ value: e.type, label: entityNames[i]! })),
          },
          {
            key: 'label',
            type: 'text',
            label: t('fieldLabel'),
            required: true,
            validation: { maxLength: 200 },
          },
          {
            key: 'type',
            type: 'select',
            label: t('type'),
            required: true,
            defaultValue: 'text',
            options: FIELD_TYPES.map((type, i) => ({ value: type, label: typeNames[i]! })),
          },
          { key: 'required', type: 'boolean', label: t('required') },
          {
            key: 'options',
            type: 'textarea',
            label: t('options'),
            help: t('optionsHelp'),
            required: true,
            visibleWhen: { fact: 'type', op: 'in', value: ['select', 'multiselect'] },
          },
        ] satisfies FieldDef[];
      },
      async build(answers, ctx, auth) {
        const entityType = answers.entityType as string;
        const label = answers.label as string;
        const type = answers.type as FieldType;
        const taken = new Set(
          (
            await ctx.db
              .select({ key: customFields.key })
              .from(customFields)
              .where(eq(customFields.entityType, entityType))
          ).map((r) => r.key),
        );
        const base = fieldKeyOf(label) || 'field';
        let key = base;
        for (let i = 2; taken.has(key); i++) key = `${base}${i}`;
        const field: FieldDef = {
          key,
          type,
          label: typedText(label, auth),
          ...(answers.required === true ? { required: true } : {}),
          ...(type === 'select' || type === 'multiselect'
            ? { options: optionsOf(answers.options as string, auth) }
            : {}),
        };
        return { op: 'create', label, value: { entityType, field } };
      },
    },
  ],
};
