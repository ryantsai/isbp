import { createFormSchema, formAudienceSchema } from '@isbp/contracts';
import { forms, formVersions, groups, workflowDefinitions } from '@isbp/db/schema';
import {
  type CustomizationHandler,
  type CustomizationIssue,
  type Db,
  type FieldDef,
  type FieldType,
  formFields,
  type FormSchema,
  formSchemaSchema,
  localize,
  localizedTextSchema,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { likePattern } from '../util';
import { FORM_SUBMISSION_TRIGGER, FormService } from '../services/forms';
import {
  coreLocalized,
  fieldKeyOf,
  isUuid,
  localeOf,
  optionsOf,
  slugOf,
  templateTexts,
  typedText,
} from './shared';

const schema = z.object({
  key: createFormSchema.shape.key.describe(
    'Unique key, a lowercase slug such as "laptop-request" (it names the form in links). Fixed after creation.',
  ),
  name: localizedTextSchema.describe('Title in the request portal, in en, zh-TW and ja-JP'),
  description: localizedTextSchema.nullish().describe('One line under the title in the portal (optional)'),
  icon: createFormSchema.shape.icon.describe('A lucide icon name, e.g. "laptop" (default "file-text")'),
  category: createFormSchema.shape.category.describe('Portal group, e.g. "Hardware" (optional)'),
  schema: formSchemaSchema.describe('The questions: fields and display elements, in order (see the guide)'),
  workflowId: z
    .uuid()
    .nullish()
    .describe('A published core.form-submission workflow that approves each submission, or null for none'),
  audience: formAudienceSchema.describe(
    'Who sees the form: { "type": "everyone" } or { "type": "groups", "groupKeys": [...] }',
  ),
  active: z.boolean().describe('Shown in the portal; false hides it without archiving it'),
});
export type FormValue = z.output<typeof schema>;

type FormRow = typeof forms.$inferSelect;

async function findForm(db: Db, id: string): Promise<FormRow | null> {
  if (!isUuid(id)) return null;
  const [f] = await db.select().from(forms).where(eq(forms.id, id));
  return f ?? null;
}

/** The live schema: the published version, or the draft of a form that was never published. */
async function liveSchema(db: Db, f: FormRow): Promise<{ schema: FormSchema; published: boolean }> {
  if (f.publishedVersion === null) return { schema: f.draft, published: false };
  const [v] = await db
    .select({ schema: formVersions.schema })
    .from(formVersions)
    .where(and(eq(formVersions.formId, f.id), eq(formVersions.version, f.publishedVersion)));
  return v ? { schema: v.schema, published: true } : { schema: f.draft, published: false };
}

const INSTRUCTIONS = `A request form is a card in the request portal ("What do you need?") that people fill in; an attached workflow approves each submission. Value: key (lowercase slug, fixed after creation), name and description (LocalizedText: give "en", "zh-TW" and "ja-JP"), icon (a lucide icon name), category (portal group), schema, workflowId, audience, active.
schema.elements, in order:
- fields: { id, key, type, label, help?, placeholder?, required?, options?, validation?, defaultValue?, visibleWhen?, width? ("full" | "half") }. Types: text, textarea, number, boolean, date, select, multiselect, email, url, user (a person). select and multiselect need options [{ "value", "label" }] with unique values. validation: min/max (numbers; choices for multiselect), minLength/maxLength (text), pattern (text, a simple regular expression).
- display elements: { id, type: "heading" | "paragraph" | "divider", text? }.
Field keys start with a lowercase letter (letters, digits and _) and are unique; ids are short unique slugs. Labels, help, placeholders and option labels are LocalizedText. visibleWhen shows a field only when a condition on the other answers holds, e.g. { "fact": "deviceType", "op": "eq", "value": "laptop" }; hidden fields are neither required nor kept.
workflowId: a published workflow of the trigger core.form-submission (reference.workflows; its conditions see the answers as data.<fieldKey>), or null for no approval. A workflow created earlier in the same change set can be referenced with "$ref:<its ref>".
audience: { "type": "everyone" } or { "type": "groups", "groupKeys": [...] } with keys from reference.groups. active false hides the form from the portal.
Applying saves and publishes the schema when it changed; submissions keep the version they were made with.`;

const laptopExample: FormValue = {
  key: 'laptop-request',
  name: { en: 'Laptop request', 'zh-TW': '筆記型電腦申請', 'ja-JP': 'ノート PC の申請' },
  description: {
    en: 'A new or replacement laptop',
    'zh-TW': '申請新的或替換的筆記型電腦',
    'ja-JP': '新規または交換用のノート PC',
  },
  icon: 'laptop',
  category: 'Hardware',
  schema: {
    elements: [
      {
        id: 'model',
        key: 'model',
        type: 'select',
        label: { en: 'Model', 'zh-TW': '機型', 'ja-JP': 'モデル' },
        required: true,
        options: [
          {
            value: 'standard',
            label: { en: 'Standard 14"', 'zh-TW': '標準 14 吋', 'ja-JP': '標準 14 インチ' },
          },
          {
            value: 'performance',
            label: { en: 'Performance 16"', 'zh-TW': '效能 16 吋', 'ja-JP': '高性能 16 インチ' },
          },
        ],
      },
      {
        id: 'amount',
        key: 'amount',
        type: 'number',
        label: { en: 'Estimated cost (TWD)', 'zh-TW': '預估金額（新台幣）', 'ja-JP': '見積額（TWD）' },
        required: true,
        validation: { min: 0 },
      },
      {
        id: 'reason',
        key: 'reason',
        type: 'textarea',
        label: { en: 'Why do you need it?', 'zh-TW': '申請原因', 'ja-JP': '申請理由' },
        required: true,
      },
    ],
  },
  workflowId: null,
  audience: { type: 'everyone' },
  active: true,
};

const TEMPLATE_TEXTS = [
  'name',
  'category',
  'workflow',
  'question',
  'type',
  'options',
  'optionsHelp',
  'required',
] as const;
const QUESTION_TYPES = ['text', 'textarea', 'number', 'date', 'select'] as const;
const QUESTIONS = [1, 2, 3] as const;

export const formKind: CustomizationHandler<FormValue> = {
  schema,

  async guide(ctx) {
    const [workflows, groupRows, categories] = await Promise.all([
      ctx.db
        .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.triggerKey, FORM_SUBMISSION_TRIGGER),
            isNull(workflowDefinitions.archivedAt),
            isNotNull(workflowDefinitions.publishedVersion),
          ),
        )
        .orderBy(asc(workflowDefinitions.name))
        .limit(200),
      ctx.db.select({ key: groups.key, name: groups.name }).from(groups).orderBy(asc(groups.name)).limit(200),
      ctx.db
        .selectDistinct({ category: forms.category })
        .from(forms)
        .where(and(isNull(forms.archivedAt), isNotNull(forms.category)))
        .orderBy(asc(forms.category)),
    ]);
    return {
      instructions: INSTRUCTIONS,
      reference: {
        workflows,
        groups: groupRows,
        categories: categories.map((c) => c.category),
        fieldTypes: [
          'text',
          'textarea',
          'number',
          'boolean',
          'date',
          'select',
          'multiselect',
          'email',
          'url',
          'user',
        ],
      },
      examples: [
        {
          description:
            'A laptop request for everyone; attach an approval workflow by setting workflowId (or "$ref:<ref>" for one created in the same change set).',
          value: laptopExample,
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx, auth) {
    const like = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select()
      .from(forms)
      .where(
        and(
          includeArchived ? undefined : isNull(forms.archivedAt),
          like
            ? or(
                ilike(forms.key, like),
                sql`${forms.name}->>'en' ilike ${like}`,
                sql`${forms.name}->>'zh-TW' ilike ${like}`,
                sql`${forms.name}->>'ja-JP' ilike ${like}`,
              )
            : undefined,
        ),
      )
      .orderBy(asc(forms.category), asc(forms.key))
      .limit(limit);
    const locale = localeOf(auth);
    return rows.map((f) => ({
      id: f.id,
      label: localize(f.name, locale) || f.key,
      description: [f.key, f.category, f.active ? null : 'inactive'].filter(Boolean).join(' · '),
      archived: Boolean(f.archivedAt),
      href: `/admin/forms/${f.id}`,
    }));
  },

  async get(id, ctx, auth) {
    const f = await findForm(ctx.db, id);
    if (!f) return null;
    const { schema: live } = await liveSchema(ctx.db, f);
    return {
      id: f.id,
      label: localize(f.name, localeOf(auth)) || f.key,
      description: f.description ? localize(f.description, localeOf(auth)) : null,
      archived: Boolean(f.archivedAt),
      href: `/admin/forms/${f.id}`,
      value: {
        key: f.key,
        name: f.name,
        description: f.description,
        icon: f.icon,
        category: f.category,
        schema: live,
        workflowId: f.workflowDefinitionId,
        audience: f.audience,
        active: f.active,
      },
    };
  },

  async check(change, ctx) {
    if (change.op !== 'create' && change.op !== 'update') return [];
    const v = change.value!;
    const issues: CustomizationIssue[] = [];
    let publishes = true;
    if (change.op === 'create') {
      const [taken] = await ctx.db.select({ id: forms.id }).from(forms).where(eq(forms.key, v.key));
      if (taken)
        issues.push({ path: 'key', code: 'duplicate_key', message: `A form with the key "${v.key}" exists` });
    } else {
      const f = (await findForm(ctx.db, change.id!))!;
      if (f.key !== v.key)
        issues.push({
          path: 'key',
          code: 'immutable',
          message: `The key of a form cannot change (it is "${f.key}")`,
        });
      if (f.archivedAt)
        issues.push({ path: '', code: 'archived', message: 'Restore the form before editing it' });
      const live = await liveSchema(ctx.db, f);
      publishes = !live.published || canonicalJson(live.schema) !== canonicalJson(v.schema);
    }
    if (publishes && !formFields(v.schema).length)
      issues.push({ path: 'schema.elements', code: 'no_fields', message: 'Add at least one field' });
    if (v.workflowId) {
      const [w] = await ctx.db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, v.workflowId));
      const problem = !w
        ? ['unknown_workflow', 'No such workflow']
        : w.triggerKey !== FORM_SUBMISSION_TRIGGER
          ? ['workflow_trigger', `The workflow decides ${w.triggerKey}, not ${FORM_SUBMISSION_TRIGGER}`]
          : w.archivedAt
            ? ['workflow_archived', 'The workflow is archived']
            : w.publishedVersion === null
              ? ['workflow_unpublished', 'Publish the workflow first']
              : null;
      if (problem) issues.push({ path: 'workflowId', code: problem[0]!, message: problem[1]! });
    }
    if (v.audience.type === 'groups') {
      const keys = v.audience.groupKeys;
      const found = new Set(
        (await ctx.db.select({ key: groups.key }).from(groups).where(inArray(groups.key, keys))).map(
          (g) => g.key,
        ),
      );
      keys.forEach((k, i) => {
        if (!found.has(k))
          issues.push({
            path: `audience.groupKeys.${i}`,
            code: 'unknown_group',
            message: `Unknown group "${k}": use a key from reference.groups`,
          });
      });
    }
    return issues;
  },

  async apply(change, ctx, auth) {
    const svc = new FormService(ctx);
    const v = change.value;
    switch (change.op) {
      case 'create': {
        const created = await svc.create(
          {
            key: v!.key,
            name: v!.name,
            description: v!.description ?? null,
            icon: v!.icon,
            category: v!.category ?? null,
          },
          auth,
        );
        await svc.update(
          created.id,
          {
            draft: v!.schema,
            workflowDefinitionId: v!.workflowId ?? null,
            audience: v!.audience,
            active: v!.active,
          },
          auth,
        );
        await svc.publish(created.id, auth);
        return { id: created.id };
      }
      case 'update': {
        const id = change.id!;
        const f = (await findForm(ctx.db, id))!;
        const live = await liveSchema(ctx.db, f);
        // An unchanged schema keeps the draft as it is (someone may be editing it in the builder).
        const publish = !live.published || canonicalJson(live.schema) !== canonicalJson(v!.schema);
        await svc.update(
          id,
          {
            name: v!.name,
            description: v!.description ?? null,
            icon: v!.icon ?? 'file-text',
            category: v!.category ?? null,
            draft: publish ? v!.schema : undefined,
            workflowDefinitionId: v!.workflowId ?? null,
            audience: v!.audience,
            active: v!.active,
          },
          auth,
        );
        if (publish) await svc.publish(id, auth);
        return { id };
      }
      case 'archive':
      case 'restore':
        await svc.setArchived(change.id!, change.op === 'archive');
        return { id: change.id! };
      default:
        throw new Error(`core.form does not support ${change.op}`);
    }
  },

  templates: [
    {
      id: 'request-form',
      label: 'core.customizations.requestForm.label',
      description: 'core.customizations.requestForm.description',
      async fields(ctx) {
        const t = await templateTexts('requestForm', TEMPLATE_TEXTS);
        const workflows = await ctx.db
          .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
          .from(workflowDefinitions)
          .where(
            and(
              eq(workflowDefinitions.triggerKey, FORM_SUBMISSION_TRIGGER),
              isNull(workflowDefinitions.archivedAt),
              isNotNull(workflowDefinitions.publishedVersion),
            ),
          )
          .orderBy(asc(workflowDefinitions.name))
          .limit(200);
        const typeLabels = await Promise.all(
          QUESTION_TYPES.map((type) => coreLocalized(`fields.types.${type}.name`)),
        );
        const fields: FieldDef[] = [
          { key: 'name', type: 'text', label: t('name'), required: true, validation: { maxLength: 200 } },
          { key: 'category', type: 'text', label: t('category'), validation: { maxLength: 64 } },
        ];
        if (workflows.length)
          fields.push({
            key: 'workflow',
            type: 'select',
            label: t('workflow'),
            options: workflows.map((w) => ({ value: w.id, label: { en: w.name } })),
          });
        for (const n of QUESTIONS) {
          const label = (key: string) =>
            Object.fromEntries(Object.entries(t(key)).map(([l, s]) => [l, `${s} ${n}`]));
          // The first question is required; later ones appear once their text is filled in.
          const shown = n === 1 ? undefined : { fact: `q${n}Label`, op: 'notEmpty' as const };
          fields.push(
            {
              key: `q${n}Label`,
              type: 'text',
              label: label('question'),
              required: n === 1,
              validation: { maxLength: 200 },
            },
            {
              key: `q${n}Type`,
              type: 'select',
              label: t('type'),
              required: true,
              defaultValue: 'text',
              options: QUESTION_TYPES.map((type, i) => ({ value: type, label: typeLabels[i]! })),
              width: 'half',
              ...(shown ? { visibleWhen: shown } : {}),
            },
            {
              key: `q${n}Required`,
              type: 'boolean',
              label: t('required'),
              width: 'half',
              ...(shown ? { visibleWhen: shown } : {}),
            },
            {
              key: `q${n}Options`,
              type: 'textarea',
              label: t('options'),
              help: t('optionsHelp'),
              required: true,
              visibleWhen: shown
                ? { all: [shown, { fact: `q${n}Type`, op: 'eq', value: 'select' }] }
                : { fact: `q${n}Type`, op: 'eq', value: 'select' },
            },
          );
        }
        return fields;
      },
      async build(answers, ctx, auth) {
        const name = answers.name as string;
        let key = slugOf(name, 60);
        if (key.length < 2) key = `form-${Date.now().toString(36)}`;
        const base = key;
        for (
          let i = 2;
          (await ctx.db.select({ id: forms.id }).from(forms).where(eq(forms.key, key))).length;
          i++
        )
          key = `${base}-${i}`;
        const keys = new Set<string>();
        const elements: FormSchema['elements'] = [];
        for (const n of QUESTIONS) {
          const label = answers[`q${n}Label`] as string | undefined;
          if (!label) continue;
          let fieldKey = fieldKeyOf(label) || `question${n}`;
          if (keys.has(fieldKey)) fieldKey = `${fieldKey}${n}`;
          keys.add(fieldKey);
          const type = (answers[`q${n}Type`] as FieldType | undefined) ?? 'text';
          elements.push({
            id: fieldKey,
            key: fieldKey,
            type,
            label: typedText(label, auth),
            ...(answers[`q${n}Required`] === true ? { required: true } : {}),
            ...(type === 'select' ? { options: optionsOf(answers[`q${n}Options`] as string, auth) } : {}),
          });
        }
        const category = (answers.category as string | undefined) ?? null;
        return {
          op: 'create',
          label: name,
          value: {
            key,
            name: typedText(name, auth),
            description: null,
            icon: 'file-text',
            category,
            schema: { elements },
            workflowId: (answers.workflow as string | undefined) ?? null,
            audience: { type: 'everyone' },
            active: true,
          },
        };
      },
    },
  ],
};
