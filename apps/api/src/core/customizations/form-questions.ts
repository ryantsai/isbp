import { forms } from '@isbp/db/schema';
import type {
  AuthContext,
  FieldDef,
  FieldType,
  FormSchema,
  LocalizedText,
  ModuleContext,
} from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import { coreLocalized, fieldKeyOf, optionsOf, slugOf, typedText } from './shared';

/*
 * The "up to three questions" part of the form templates (request form, approval process): the questions as
 * template fields, and the form elements they become.
 */

export const QUESTION_TYPES = ['text', 'textarea', 'number', 'date', 'select'] as const;
export const QUESTIONS = [1, 2, 3] as const;
/** Catalog keys under `core.customizations.<template>` the questions need. */
export const QUESTION_TEXTS = ['question', 'type', 'options', 'optionsHelp', 'required'] as const;

/** Question n: its text, answer type, required switch and (for choices) one option per line. */
export async function questionFields(
  t: (key: string) => LocalizedText,
  opts: { firstRequired: boolean },
): Promise<FieldDef[]> {
  const typeLabels = await Promise.all(
    QUESTION_TYPES.map((type) => coreLocalized(`fields.types.${type}.name`)),
  );
  const fields: FieldDef[] = [];
  for (const n of QUESTIONS) {
    const label = (key: string) =>
      Object.fromEntries(Object.entries(t(key)).map(([l, s]) => [l, `${s} ${n}`])) as LocalizedText;
    // Later questions (and an optional first one) show their details once their text is filled in.
    const shown = n === 1 && opts.firstRequired ? undefined : { fact: `q${n}Label`, op: 'notEmpty' as const };
    fields.push(
      {
        key: `q${n}Label`,
        type: 'text',
        label: label('question'),
        required: n === 1 && opts.firstRequired,
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
}

/** The answered questions as form fields (keys from their text, unique among `taken`, which grows). */
export function questionElements(
  answers: Record<string, unknown>,
  auth: AuthContext,
  taken: Set<string> = new Set(),
): FormSchema['elements'] {
  const elements: FormSchema['elements'] = [];
  for (const n of QUESTIONS) {
    const label = answers[`q${n}Label`] as string | undefined;
    if (!label) continue;
    let fieldKey = fieldKeyOf(label) || `question${n}`;
    if (taken.has(fieldKey)) fieldKey = `${fieldKey}${n}`;
    taken.add(fieldKey);
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
  return elements;
}

/** A form key from a name that no form has yet (`monitor-request`, `monitor-request-2`, …). */
export async function unusedFormKey(ctx: ModuleContext, name: string): Promise<string> {
  let key = slugOf(name, 60);
  if (key.length < 2) key = `form-${Date.now().toString(36)}`;
  const base = key;
  for (let i = 2; (await ctx.db.select({ id: forms.id }).from(forms).where(eq(forms.key, key))).length; i++)
    key = `${base}-${i}`;
  return key;
}
