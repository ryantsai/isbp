import { createFormSchema, formAudienceSchema } from '@isbp/contracts';
import { forms, formVersions, groups, workflowDefinitions } from '@isbp/db/schema';
import {
  type AuthContext,
  conditionFacts,
  type CustomizationHandler,
  type CustomizationIssue,
  type CustomizationLink,
  type Db,
  ErrorCodes,
  FIELD_TYPES,
  type FieldDef,
  formFields,
  type FormSchema,
  formSchemaSchema,
  HttpError,
  isField,
  localize,
  localizedTextSchema,
  RESERVED_FACTS,
  validateFields,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '../../kernel/crypto';
import { maskFormSecrets } from '../../kernel/process-actions';
import { getKernel } from '../kernel-ref';
import { likePattern } from '../util';
import { FORM_SUBMISSION_TRIGGER, FormService } from '../services/forms';
import { approvalProcessTemplate } from './approval-process';
import { configChangeForm } from './examples';
import { QUESTION_TEXTS, questionElements, questionFields, unusedFormKey } from './form-questions';
import { pickableRecordTypes, recordTypeReference } from './record-reference';
import { catalogLocalized, catalogText, isUuid, localeOf, templateTexts, typedText } from './shared';

const schema = z.object({
  key: createFormSchema.shape.key.describe(
    'Unique key, a lowercase slug such as "laptop-request" (it names the form in links). Fixed after creation.',
  ),
  name: localizedTextSchema.describe('Title in the request portal, in en, zh-TW and ja-JP'),
  description: localizedTextSchema.nullish().describe('One line under the title in the portal (optional)'),
  icon: createFormSchema.shape.icon.describe('A lucide icon name, e.g. "laptop" (default "file-text")'),
  category: createFormSchema.shape.category.describe('Portal group, e.g. "Hardware" (optional)'),
  schema: formSchemaSchema.describe(
    'The questions (fields and display elements, in order), rules across answers and process actions (see the guide)',
  ),
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

/** Whether a proposed schema differs from the stored one (secrets compare as `{ set: true }`). */
const schemaChanged = (stored: FormSchema, proposed: FormSchema) =>
  canonicalJson(maskFormSecrets(stored)) !== canonicalJson(proposed);

/** The admin API's checks of a schema's process actions (types, permissions, configs) as change-set issues. */
async function actionIssues(
  schema: FormSchema,
  previous: FormSchema['actions'],
  auth: AuthContext,
  db: Db,
): Promise<CustomizationIssue[]> {
  if (!schema.actions?.length) return [];
  try {
    // Through the change set's transaction: an action may name a group or category an earlier item creates.
    await getKernel().processActions.prepare(schema, previous, auth, { prefix: 'schema', db });
    return [];
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    const details = (err.details ?? {}) as {
      issues?: { path: string; message: string; code?: string }[];
      path?: string;
    };
    // Not the value's fault: applying it needs someone holding the action's permission (a reviewer can).
    if (err.statusCode === 403) return [];
    if (details.issues?.length)
      return details.issues.map((i) => ({ path: i.path, code: i.code ?? 'invalid', message: i.message }));
    return [
      { path: details.path ?? 'schema.actions', code: String(err.code).toLowerCase(), message: err.message },
    ];
  }
}

const PROBE_PREFIX = 'probe_';

/**
 * A form with one field of every type (a record field per record type), so action types list the configuration
 * fields that only exist when the form has such a field ("Affected CIs from" needs a record field of CIs). Their
 * options are then the probe's keys, which the guide turns into "a field of this form of type …".
 */
function probeForm(recordTypes: readonly string[]): FormSchema {
  const plain = FIELD_TYPES.filter((t) => t !== 'record' && t !== 'rows').map((type) => ({
    id: `${PROBE_PREFIX}${type}`,
    key: `${PROBE_PREFIX}${type}`,
    type,
    label: { en: type },
    ...(type === 'select' || type === 'multiselect' ? { options: [{ value: 'a', label: { en: 'a' } }] } : {}),
  }));
  const records = recordTypes.map((type, i) => ({
    id: `${PROBE_PREFIX}record${i}`,
    key: `${PROBE_PREFIX}record${i}`,
    type: 'record' as const,
    label: { en: type },
    record: { types: [type] },
  }));
  return { elements: [...plain, ...records] };
}

/** The process actions a person may add, with their configuration fields, in English for models. */
async function actionReference(auth: AuthContext, recordTypes: readonly string[]) {
  const probe = probeForm(recordTypes);
  const probeFields = new Map(formFields(probe).map((f) => [f.key, f]));
  const items = await getKernel().processActions.describe(probe, auth, 'en');
  return Promise.all(
    items.map(async (a) => ({
      type: a.type,
      name: await catalogText(a.name),
      description: await catalogText(a.description),
      allowed: a.allowed,
      ...(a.allowed ? {} : { needs: a.permission }),
      secrets: a.secrets,
      fields: a.fields.map((f) => {
        // Options naming the probe's fields stand for "a field of this form" of that type.
        const fromForm = (f.options ?? []).flatMap((o) => {
          const prefixed = o.value.startsWith('field:');
          const field = probeFields.get(prefixed ? o.value.slice(6) : o.value);
          return field ? [{ field, prefixed }] : [];
        });
        const fixed = (f.options ?? []).filter(
          (o) => !probeFields.has(o.value.startsWith('field:') ? o.value.slice(6) : o.value),
        );
        const fieldTypes = [...new Set(fromForm.map((x) => x.field.type))];
        const recordTypesOf = [...new Set(fromForm.flatMap((x) => x.field.record?.types ?? []))];
        return {
          key: f.key,
          type: f.type,
          label: localize(f.label, 'en'),
          ...(f.required ? { required: true } : {}),
          ...(f.help ? { help: localize(f.help, 'en') } : {}),
          ...(f.defaultValue !== undefined ? { default: f.defaultValue } : {}),
          ...(fixed.length
            ? {
                options: fixed.slice(0, 50).map((o) => ({ value: o.value, label: localize(o.label, 'en') })),
              }
            : {}),
          ...(fromForm.length
            ? {
                formField: {
                  value: fromForm.some((x) => x.prefixed) ? 'field:<fieldKey>' : '<fieldKey>',
                  types: fieldTypes,
                  ...(recordTypesOf.length ? { recordTypes: recordTypesOf } : {}),
                  note: 'The key of one of this form’s own fields of these types; only offered when the form has one.',
                },
              }
            : {}),
        };
      }),
    })),
  );
}

/** The form's own page in the portal, while people can use it. */
async function formLinks(f: FormRow): Promise<CustomizationLink[]> {
  if (f.publishedVersion === null || !f.active || f.archivedAt) return [];
  return [
    {
      href: `/requests/forms/${f.key}`,
      label: await catalogLocalized('core.customizations.links.openForm'),
    },
  ];
}

/** Record types a field already offers stay, whoever edits it (as in `assertRecordFieldTypes`). */
const offeredBefore = (before: FormSchema | null, key: string) =>
  new Set(formFields(before).find((b) => b.key === key && b.type === 'record')?.record?.types ?? []);

/**
 * Record types a field newly offers must be ones the person may pick from (the admin API refuses others). A
 * permission matter, not the value's: refused with 403 and the permission, so a dry run marks it as needing a reviewer
 * who holds it.
 */
function assertRecordTypesOffered(schema: FormSchema, before: FormSchema | null, auth: AuthContext) {
  const records = getKernel().records;
  const pickable = new Set(records.types(auth).map((t) => t.type));
  // Record fields, and the record columns of tables (`<table key>.<column key>`).
  const recordFields = schema.elements.flatMap((el, i) =>
    !isField(el)
      ? []
      : el.type === 'record'
        ? [{ field: el, kept: offeredBefore(before, el.key), path: `schema.elements.${i}.record.types` }]
        : el.type === 'rows'
          ? (el.rows?.fields ?? []).flatMap((c, j) =>
              c.type === 'record'
                ? [
                    {
                      field: c,
                      kept: new Set(
                        formFields(before)
                          .find((b) => b.key === el.key && b.type === 'rows')
                          ?.rows?.fields.find((b) => b.key === c.key && b.type === 'record')?.record?.types ??
                          [],
                      ),
                      path: `schema.elements.${i}.rows.fields.${j}.record.types`,
                    },
                  ]
                : [],
            )
          : [],
  );
  recordFields.forEach(({ field: el, kept, path }) => {
    for (const type of el.record?.types ?? []) {
      const entry = records.entry(type);
      if (!entry || kept.has(type) || pickable.has(type)) continue;
      throw new HttpError(
        403,
        ErrorCodes.FORBIDDEN,
        `Offering ${type} records needs ${entry.def.permission}`,
        {
          permission: entry.def.permission,
          path,
        },
      );
    }
  });
}

/**
 * What the form builder refuses to save beyond the shared schema (`elementIssues`, `ruleIssues` in the web app), and
 * record types that don't exist: a change set can't publish what the builder wouldn't.
 */
function builderIssues(schema: FormSchema): CustomizationIssue[] {
  const issues: CustomizationIssue[] = [];
  const fields = formFields(schema);
  const keys = new Set(fields.map((f) => f.key));
  const records = getKernel().records;
  schema.elements.forEach((el, i) => {
    const path = `schema.elements.${i}`;
    const facts = conditionFacts(el.visibleWhen)
      .filter((k) => !RESERVED_FACTS.includes(k))
      .map((k) => k.split('.')[0] ?? '');
    if (!isField(el)) {
      if ((el.type === 'heading' || el.type === 'paragraph') && !el.text)
        issues.push({
          path: `${path}.text`,
          code: 'text_required',
          message: 'Headings and paragraphs need text',
        });
      if (facts.some((k) => !keys.has(k)))
        issues.push({
          path: `${path}.visibleWhen`,
          code: 'unknown_field',
          message: 'visibleWhen reads a field key this form does not have',
        });
      return;
    }
    if (facts.includes(el.key))
      issues.push({
        path: `${path}.visibleWhen`,
        code: 'condition_self',
        message: 'A field cannot be shown depending on its own answer',
      });
    else if (facts.some((k) => !keys.has(k)))
      issues.push({
        path: `${path}.visibleWhen`,
        code: 'unknown_field',
        message: 'visibleWhen reads a field key this form does not have',
      });
    const dv = el.defaultValue;
    if (
      el.type !== 'user' &&
      el.type !== 'record' &&
      dv !== undefined &&
      dv !== null &&
      dv !== '' &&
      !(Array.isArray(dv) && !dv.length) &&
      !validateFields([{ ...el, required: false, visibleWhen: undefined }], { [el.key]: dv }).ok
    )
      issues.push({
        path: `${path}.defaultValue`,
        code: 'default_invalid',
        message: 'The default value is not a valid answer for this field',
      });
    if (el.type === 'record')
      el.record?.types.forEach((type, j) => {
        if (!records.entry(type))
          issues.push({
            path: `${path}.record.types.${j}`,
            code: 'unknown_record_type',
            message: `Unknown record type "${type}": use a type from reference.recordTypes`,
          });
      });
    if (el.type === 'rows')
      el.rows?.fields.forEach((c, j) =>
        c.record?.types.forEach((type, k) => {
          if (c.type === 'record' && !records.entry(type))
            issues.push({
              path: `${path}.rows.fields.${j}.record.types.${k}`,
              code: 'unknown_record_type',
              message: `Unknown record type "${type}": use a type from reference.recordTypes`,
            });
        }),
      );
  });
  // An action's condition reads data.<field key> (a table's column: data.<table>.<column>), records.<field>.<fact>,
  // steps.<step>.<field>, requester.<fact> or today.
  schema.actions?.forEach((action, i) => {
    const bad = conditionFacts(action.when).filter((k) => {
      const [root = '', key = ''] = k.split('.');
      if (RESERVED_FACTS.includes(k) || root === 'steps' || root === 'requester') return false;
      return !((root === 'data' || root === 'records') && keys.has(key));
    });
    if (bad.length)
      issues.push({
        path: `schema.actions.${i}.when`,
        code: 'unknown_field',
        message: `The condition reads ${bad.join(', ')}: use data.<field key>, records.<field key>.<fact>, steps.<step id>.<field key>, requester.<fact> or today`,
      });
  });
  schema.rules?.forEach((rule, i) => {
    const path = `schema.rules.${i}`;
    if (!conditionFacts(rule.require).length)
      issues.push({
        path: `${path}.require`,
        code: 'require_empty',
        message: 'A rule must require something of the answers',
      });
    const used = [...conditionFacts(rule.when), ...conditionFacts(rule.require)].filter(
      (k) => !RESERVED_FACTS.includes(k),
    );
    if (used.some((k) => !keys.has(k.split('.')[0] ?? '')))
      issues.push({
        path,
        code: 'unknown_field',
        message:
          'The rule reads a field key this form does not have (conditions use field keys, not data.<key>)',
      });
  });
  return issues;
}

const INSTRUCTIONS = `A request form is a card in the request portal ("What do you need?") that people fill in on its own page, /requests/forms/<key>; an attached workflow approves each submission. Value: key (lowercase slug, fixed after creation), name and description (LocalizedText: give "en", "zh-TW" and "ja-JP"), icon (a lucide icon name), category (portal group), schema, workflowId, audience, active.
schema.elements, in order:
- fields: { id, key, type, label, help?, placeholder?, required?, options?, validation?, defaultValue?, visibleWhen?, width? ("full" | "half"), record? }. Types: text, textarea, number, boolean, date (an answer "YYYY-MM-DD"), select, multiselect, email, url, user (a person), record (records of other modules, such as configuration items), rows (a table: firewall rule lines, accounts, backup items). select and multiselect need options [{ "value", "label" }] with unique values. validation: min/max (numbers; choices for multiselect), minLength/maxLength (text), pattern (text, a simple regular expression). A defaultValue must itself be a valid answer.
- record fields need record: { "types": ["<record type>"], "multiple"?: true (several, at most 20), "where"?: <condition on the record type's facts> }, with types from reference.recordTypes only (the ones this person may offer). Answers are refs "<type>:<id>"; people can pick only records they may read and that match where, e.g. { "fact": "environment", "op": "eq", "value": "production" } (facts and their values: reference.recordTypes[].facts).
- rows fields need rows: { "fields": [<columns>], "min"?: <rows>, "max"?: <rows, at most 50> }; columns are fields of the other types except rows, without visibleWhen (e.g. [{ "key": "port", "type": "number", "label": {…}, "required": true }, { "key": "protocol", "type": "select", "label": {…}, "options": [...] }]). The answer is a list of rows ({ "port": 443, "protocol": "tcp" }); completely empty rows are ignored; required means at least one row. No defaultValue. Conditions read a column across all rows as data.<table>.<column> in workflows and actions (<table>.<column> in visibleWhen and rules): eq/in/contains match any row.
- display elements: { id, type: "heading" | "paragraph" | "divider", text? } (headings and paragraphs need text).
Field keys start with a lowercase letter (letters, digits and _) and are unique; ids are short unique slugs. Labels, help, placeholders and option labels are LocalizedText. visibleWhen shows a field only when a condition on the other answers (by field key, never its own) holds, e.g. { "fact": "deviceType", "op": "eq", "value": "laptop" }; hidden fields are neither required nor kept.
schema.rules (optional): checks across answers, run in the browser and the API like field validation — [{ id, when?, require, message, fields? }]. When "when" holds (always without it), "require" must hold; otherwise "message" (LocalizedText) is shown on "fields" (field keys) or above the form. Conditions read the answers by field key (not data.<key>); { "fact": "plannedEnd", "op": "gte", "valueFact": "plannedStart" } compares two answers (dates compare as dates); "valueOffsetDays" shifts the compared date ({ "fact": "plannedEnd", "op": "lte", "valueFact": "plannedStart", "valueOffsetDays": 366 }: at most a year after the start); the reserved fact "today" (YYYY-MM-DD, UTC) is available too ({ "fact": "plannedStart", "op": "gte", "valueFact": "today" }); and "require" must read at least one answer. Example: { "id": "rollback", "when": { "fact": "risk", "op": "eq", "value": "high" }, "require": { "fact": "backoutPlan", "op": "notEmpty" }, "message": { "en": "A high-risk change needs a rollback plan", "zh-TW": "…", "ja-JP": "…" }, "fields": ["backoutPlan"] }.
workflowId: a published workflow of the trigger core.form-submission (reference.workflows), or null for no approval. Its conditions and approver rules see the answers as data.<fieldKey> and the facts of the records picked in record fields as records.<fieldKey>.<fact> (a list per fact for multiple fields), e.g. { "type": "fact", "fact": "records.cis.ownerGroup", "kind": "group" } lets the picked CIs' support group approve. A workflow created earlier in the same change set can be referenced with "$ref:<its ref>" (describe core.workflow for its schema).
audience: { "type": "everyone" } or { "type": "groups", "groupKeys": [...] } with keys from reference.groups. active false hides the form from the portal.
schema.actions (optional): what happens after a submission — [{ id, on, type, name?, when?, config }]. when (optional) runs the action only if a condition holds when the outcome is recorded, on data.<fieldKey>, records.<fieldKey>.<fact>, steps.<stepId>.<fieldKey> (what an approver filled in), requester.departmentCode / requester.jobTitle, and today; an action whose condition doesn't hold is shown as skipped. Use it for choices ("grant the VPN role only when access = vpn"). core.remind sends a reminder on a date from an answer, a step field or the outcome, plus or minus days (offsetDays, negative = before). on: "submitted" (when sent), "approved" or "rejected" (when the workflow decides; a form without a workflow runs "approved" actions when sent). type: one of reference.processActions (only those with allowed: true can be added by this person). config: the action's fields (reference.processActions[].fields, by key): select values from their options; a field with "formField" takes the key of one of this form's own fields of those types (written as formField.value, e.g. "cis" or "field:approver"), and is only available when the form has such a field. Text fields may use templates: {{data.<fieldKey>}}, {{answers.<fieldKey>}} (as shown, e.g. option labels and names), {{records.<fieldKey>.<fact>}}, {{requester.displayName}}, {{requester.email}}, {{request.reference}}, {{request.url}}, {{request.form}}, {{decidedBy.displayName}}; unknown paths render empty. Secret fields (secrets) are never shown: give the text to set one, or { "set": true } to keep the stored value. Actions run in the background after the outcome, retried, and are shown on the request; actions never skip another approval (a change still goes through its CAB).
Applying saves and publishes the schema when it changed; submissions keep the version they were made with (and run that version's actions). Once applied, the change set shows the form's own link (/requests/forms/<key>): give it to the person.`;

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

const TEMPLATE_TEXTS = ['name', 'category', 'workflow', ...QUESTION_TEXTS] as const;

export const formKind: CustomizationHandler<FormValue> = {
  schema,

  async guide(ctx, auth) {
    const pickable = pickableRecordTypes(auth);
    const [workflows, groupRows, categories, processActions, recordTypes] = await Promise.all([
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
      actionReference(
        auth,
        pickable.map((t) => t.type),
      ),
      recordTypeReference(pickable),
    ]);
    return {
      instructions: INSTRUCTIONS,
      reference: {
        workflows,
        groups: groupRows,
        categories: categories.map((c) => c.category),
        fieldTypes: [...FIELD_TYPES],
        recordTypes,
        processActions,
      },
      examples: [
        {
          description:
            'A laptop request for everyone; attach an approval workflow by setting workflowId (or "$ref:<ref>" for one created in the same change set).',
          value: laptopExample,
        },
        {
          description:
            'A configuration change request: CIs picked from the CMDB (a multiple record field), two rules (the end after the start; a rollback plan when the risk is high) and, on approval, a change raised for the picked CIs and submitted to its CAB authorization. Its workflow (see core.workflow) is set with workflowId "$ref:<ref>" when proposed in the same change set; null here.',
          value: configChangeForm(null),
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
      links: await formLinks(f),
      value: {
        key: f.key,
        name: f.name,
        description: f.description,
        icon: f.icon,
        category: f.category,
        // Secrets of process actions stay sealed on the server (`{ set: true }` keeps them on apply).
        schema: maskFormSecrets(live),
        workflowId: f.workflowDefinitionId,
        audience: f.audience,
        active: f.active,
      },
    };
  },

  async check(change, ctx, auth) {
    if (change.op !== 'create' && change.op !== 'update') return [];
    const v = change.value!;
    const issues: CustomizationIssue[] = [];
    let publishes = true;
    let liveActions: FormSchema['actions'];
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
      publishes = !live.published || schemaChanged(live.schema, v.schema);
      liveActions = live.schema.actions;
    }
    if (publishes && !formFields(v.schema).length)
      issues.push({ path: 'schema.elements', code: 'no_fields', message: 'Add at least one field' });
    // What the builder refuses (conditions on unknown fields, empty rules, unknown record types).
    if (publishes) issues.push(...builderIssues(v.schema));
    // Process actions are held to exactly what the form builder's save would accept.
    if (publishes) issues.push(...(await actionIssues(v.schema, liveActions, auth, ctx.db)));
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
        assertRecordTypesOffered(v!.schema, null, auth);
        // The `*Row` writes: the kind only needs the ids, not the views the admin API returns.
        const created = await svc.createRow(
          {
            key: v!.key,
            name: v!.name,
            description: v!.description ?? null,
            icon: v!.icon,
            category: v!.category ?? null,
          },
          auth,
        );
        await svc.updateRow(
          created.id,
          {
            draft: v!.schema,
            workflowDefinitionId: v!.workflowId ?? null,
            audience: v!.audience,
            active: v!.active,
          },
          auth,
        );
        await svc.publishRow(created.id, auth);
        return { id: created.id };
      }
      case 'update': {
        const id = change.id!;
        const f = (await findForm(ctx.db, id))!;
        const live = await liveSchema(ctx.db, f);
        // An unchanged schema keeps the draft as it is (someone may be editing it in the builder).
        const publish = !live.published || schemaChanged(live.schema, v!.schema);
        if (publish) assertRecordTypesOffered(v!.schema, f.draft, auth);
        await svc.updateRow(
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
        if (publish) await svc.publishRow(id, auth);
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
        // The first question is required; later ones appear once their text is filled in.
        fields.push(...(await questionFields(t, { firstRequired: true })));
        return fields;
      },
      async build(answers, ctx, auth) {
        const name = answers.name as string;
        const key = await unusedFormKey(ctx, name);
        const elements = questionElements(answers, auth);
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
    approvalProcessTemplate,
  ],
};
