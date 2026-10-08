/**
 * Small builders for the ISMS process pack: text in three languages, form fields, conditions, approval steps,
 * process actions and the change-set items themselves. Everything here produces plain data in the kinds' schemas
 * (`core.form`, `core.workflow`, `scheduler.job` …); nothing is live until a person applies the change set.
 */
import {
  type ApprovalStep,
  type ApproverRule,
  type ChangeSetPackageItem,
  type Condition,
  type ConditionValue,
  type DisplayElement,
  type FieldDef,
  type FieldOption,
  type FormAction,
  type FormElement,
  type FormRule,
  type Locale,
  localize,
  type LocalizedText,
  type ProcessActionOutcome,
  type WorkflowStep,
} from '@isbp/sdk';

/* ───────────────────────────── text ───────────────────────────── */

/**
 * Text in English, Traditional Chinese (Taiwan) and Japanese, for values the kinds keep in every language (form and
 * field labels, step names): the reader sees their own.
 */
export const t = (en: string, zh: string, ja: string): LocalizedText => ({ en, 'zh-TW': zh, 'ja-JP': ja });

/**
 * Text the kinds keep in one language (group and job names, workflow descriptions, reminder, notification and ticket
 * texts, item labels), given in three: {@link inLocale} replaces it with the installer's language (English when
 * missing) when the package is built. `{{…}}` placeholders stay the same in every language.
 */
export interface PlainText {
  readonly $plain: LocalizedText;
}

export const plain = (en: string, zh: string, ja: string): PlainText => ({
  $plain: { en, 'zh-TW': zh, 'ja-JP': ja },
});

/** Plain text, or a string without words (only `{{…}}` placeholders), which reads the same in every language. */
export type Plain = PlainText | string;

const isPlainText = (v: unknown): v is PlainText =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && '$plain' in v;

/** A copy of `value` with every {@link PlainText} in it replaced by its text in `locale`. */
function resolve(value: unknown, locale: Locale): unknown {
  if (isPlainText(value)) return localize(value.$plain, locale);
  if (Array.isArray(value)) return value.map((v) => resolve(v, locale));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, locale)]));
  return value;
}

/** A package item as the pack writes it: its label and note, and any plain text in its value, in three languages. */
export interface ItemTemplate extends Omit<ChangeSetPackageItem, 'label' | 'note'> {
  label?: PlainText;
  note?: PlainText;
}

/** The item for one locale: every {@link PlainText} replaced by its text. */
export function inLocale(item: ItemTemplate, locale: Locale): ChangeSetPackageItem {
  const { label, note, value, ...rest } = item;
  return {
    ...rest,
    ...(label ? { label: localize(label.$plain, locale) } : {}),
    ...(value !== undefined ? { value: resolve(value, locale) } : {}),
    ...(note ? { note: localize(note.$plain, locale) } : {}),
  };
}

/** `"$ref:<ref>"`: the id of an object an earlier item of the package creates. */
export const ref = (name: string) => `$ref:${name}`;

/* ───────────────────────────── groups ───────────────────────────── */

/** The groups the pack creates: their item ref (where an id goes) and key (where a key goes). */
export const GROUPS = {
  authority: { ref: 'group-authority', key: 'isms-authority' },
  it: { ref: 'group-it', key: 'isms-it' },
  network: { ref: 'group-network', key: 'isms-network' },
  serverRoom: { ref: 'group-server-room', key: 'isms-server-room' },
  securityReview: { ref: 'group-security-review', key: 'isms-security-review' },
} as const;

/** The service desk categories the pack creates (`itsm.category`). */
export const CATEGORIES = {
  resourceAnomaly: { ref: 'category-resource-anomaly', key: 'isms-resource-anomaly' },
  threatIntel: { ref: 'category-threat-intel', key: 'isms-threat-intel' },
  securityReport: { ref: 'category-security-report', key: 'isms-security-report' },
} as const;

/* ───────────────────────────── fields ───────────────────────────── */

export const opt = (value: string, label: LocalizedText): FieldOption => ({ value, label });

type Extra = Partial<Omit<FieldDef, 'key' | 'type' | 'label'>>;

const field =
  (type: FieldDef['type']) =>
  (key: string, label: LocalizedText, extra: Extra = {}): FieldDef => ({ key, type, label, ...extra });

export const text = field('text');
export const textarea = field('textarea');
export const number = field('number');
export const boolean = field('boolean');
export const date = field('date');
export const url = field('url');
export const user = field('user');

export const select = (key: string, label: LocalizedText, options: FieldOption[], extra: Extra = {}) =>
  field('select')(key, label, { options, ...extra });

export const multiselect = (key: string, label: LocalizedText, options: FieldOption[], extra: Extra = {}) =>
  field('multiselect')(key, label, { options, ...extra });

/** A `record` field: records of other modules, optionally several and filtered by their facts. */
export const record = (
  key: string,
  label: LocalizedText,
  types: string[],
  opts: { multiple?: boolean; where?: Condition } & Extra = {},
): FieldDef => {
  const { multiple, where, ...extra } = opts;
  return field('record')(key, label, {
    record: { types, ...(multiple ? { multiple } : {}), ...(where ? { where } : {}) },
    ...extra,
  });
};

/** A table (`rows`): columns of the simple types, at most 50 rows. */
export const rows = (
  key: string,
  label: LocalizedText,
  columns: FieldDef[],
  opts: { min?: number; max?: number } & Extra = {},
): FieldDef => {
  const { min, max, ...extra } = opts;
  return field('rows')(key, label, {
    rows: { fields: columns, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) },
    ...extra,
  });
};

/** A box that must be ticked (a required boolean only accepts `true`): consents and checklists. */
export const mustTick = (key: string, label: LocalizedText, extra: Extra = {}) =>
  boolean(key, label, { required: true, ...extra });

export const heading = (id: string, text: LocalizedText): DisplayElement => ({ id, type: 'heading', text });
export const paragraph = (id: string, text: LocalizedText): DisplayElement => ({
  id,
  type: 'paragraph',
  text,
});

/** A form's elements: fields get their key as id. */
export const elements = (...items: (FieldDef | DisplayElement)[]): FormElement[] =>
  items.map((item) => ('key' in item ? { id: item.key, ...item } : item));

/* ───────────────────────────── shared choices ───────────────────────────── */

export const NORMAL = [
  opt('normal', t('Normal', '正常', '正常')),
  opt('abnormal', t('Abnormal', '異常', '異常')),
];
export const OK_ISSUE = [
  opt('ok', t('OK', '正常', '問題なし')),
  opt('issue', t('Issue found', '有異常', '問題あり')),
];
export const PRIVILEGES = [
  opt('admin', t('Administrator', '管理者權限', '管理者')),
  opt('user', t('Standard user', '一般使用者', '標準ユーザー')),
];

/* ───────────────────────────── conditions ───────────────────────────── */

export const eq = (fact: string, value: ConditionValue): Condition => ({ fact, op: 'eq', value });
export const neq = (fact: string, value: ConditionValue): Condition => ({ fact, op: 'neq', value });
export const isIn = (fact: string, value: ConditionValue[]): Condition => ({ fact, op: 'in', value });
export const notEmpty = (fact: string): Condition => ({ fact, op: 'notEmpty' });
export const any = (...conditions: Condition[]): Condition => ({ any: conditions });
export const all = (...conditions: Condition[]): Condition => ({ all: conditions });

/** A rule across answers: when `when` holds, `require` must, or `message` shows on `fields`. */
export const rule = (
  id: string,
  require: Condition,
  message: LocalizedText,
  opts: { when?: Condition; fields?: string[] } = {},
): FormRule => ({
  id,
  ...(opts.when ? { when: opts.when } : {}),
  require,
  message,
  ...(opts.fields ? { fields: opts.fields } : {}),
});

/** `fact` is on or after `otherFact` (two date answers). */
export const notBefore = (fact: string, otherFact: string): Condition => ({
  fact,
  op: 'gte',
  valueFact: otherFact,
});

/** `fact` is at most `days` after `otherFact`. */
export const withinDays = (fact: string, otherFact: string, days: number): Condition => ({
  fact,
  op: 'lte',
  valueFact: otherFact,
  valueOffsetDays: days,
});

/** `fact` is after today. */
export const afterToday = (fact: string): Condition => ({ fact, op: 'gt', valueFact: 'today' });

/* ───────────────────────────── approval steps ───────────────────────────── */

type StepExtra = Partial<Omit<ApprovalStep, 'id' | 'type' | 'name' | 'approvers' | 'mode'>>;

/** The requester's manager; skipped for people without one. */
export const managerStep = (extra: StepExtra = {}): ApprovalStep => ({
  id: 'manager',
  type: 'approval',
  name: t('Manager approval', '主管簽核', '上長の承認'),
  approvers: [{ type: 'manager' }],
  mode: 'any',
  ifNoApprover: 'skip',
  ...extra,
});

/** Any member of a group decides. */
export const groupStep = (
  id: string,
  groupKey: string,
  name: LocalizedText,
  extra: StepExtra = {},
): ApprovalStep => ({
  id,
  type: 'approval',
  name,
  approvers: [{ type: 'group', groupKey } satisfies ApproverRule],
  mode: 'any',
  ...extra,
});

/** The ISMS approvers' sign-off (權責主管簽核). */
export const authorityStep = (extra: StepExtra = {}): ApprovalStep =>
  groupStep(
    'authority',
    GROUPS.authority.key,
    t('ISMS approver sign-off', '權責主管簽核', 'ISMS 承認者の承認'),
    extra,
  );

/* ───────────────────────────── process actions ───────────────────────────── */

export const action = (
  id: string,
  on: ProcessActionOutcome,
  type: string,
  name: LocalizedText,
  config: Record<string, unknown>,
  when?: Condition,
): FormAction => ({ id, on, type, name, ...(when ? { when } : {}), config });

/** `core.remind`: a reminder on a date answer (`field:<key>`), `offsetDays` before (negative) or after. */
export const remind = (
  id: string,
  name: LocalizedText,
  opts: {
    dateField: string;
    offsetDays?: number;
    toRequester?: boolean;
    groupKeys?: string[];
    userFields?: string[];
    title: PlainText;
    message?: Plain;
    when?: Condition;
  },
): FormAction =>
  action(
    id,
    'approved',
    'core.remind',
    name,
    {
      dateFrom: `field:${opts.dateField}`,
      offsetDays: opts.offsetDays ?? 0,
      onlyFuture: true,
      toRequester: opts.toRequester ?? true,
      ...(opts.userFields?.length ? { userFields: opts.userFields.map((k) => `field:${k}`) } : {}),
      ...(opts.groupKeys?.length ? { groups: opts.groupKeys } : {}),
      title: opts.title,
      ...(opts.message ? { message: opts.message } : {}),
    },
    opts.when,
  );

/** `itsm.create-ticket`: an incident or service request for the requester, in a category and group of the pack. */
export const raiseTicket = (
  id: string,
  on: ProcessActionOutcome,
  name: LocalizedText,
  opts: {
    type?: 'incident' | 'service_request';
    priority?: '1' | '2' | '3' | '4';
    categoryRef?: string;
    groupRef?: string;
    title: PlainText;
    description: Plain;
    when?: Condition;
  },
): FormAction =>
  action(
    id,
    on,
    'itsm.create-ticket',
    name,
    {
      type: opts.type ?? 'incident',
      priority: opts.priority ?? '3',
      title: opts.title,
      description: opts.description,
      ...(opts.categoryRef ? { categoryId: ref(opts.categoryRef) } : {}),
      ...(opts.groupRef ? { groupId: ref(opts.groupRef) } : {}),
    },
    opts.when,
  );

/* ───────────────────────────── items ───────────────────────────── */

export interface FormValue {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  /** Portal group: security, access, hardware, software or changes. */
  category: 'security' | 'access' | 'hardware' | 'software' | 'changes';
  schema: { elements: FormElement[]; rules?: FormRule[]; actions?: FormAction[] };
  /** Group keys of the audience; everyone when left out. */
  audience?: string[];
}

/**
 * A form, and its approval workflow before it when it has steps. Workflow names are keys of the isms catalog
 * (`isms.packages.processes.workflows.<name>`), which the admin pages show in the reader's language until someone
 * renames the workflow; the item's `label` is that catalog text (the change set shows it).
 */
export function requestProcess(
  form: FormValue,
  workflow?: { name: string; label: PlainText; description: PlainText; steps: WorkflowStep[] },
): ItemTemplate[] {
  const workflowRef = `workflow-${form.key.replace(/^isms-/, '')}`.slice(0, 40);
  const items: ItemTemplate[] = [];
  if (workflow)
    items.push({
      ref: workflowRef,
      kind: 'core.workflow',
      op: 'create',
      label: workflow.label,
      value: {
        name: `isms.packages.processes.workflows.${workflow.name}`,
        description: workflow.description,
        triggerKey: 'core.form-submission',
        isDefault: false,
        graph: { steps: workflow.steps },
      },
    });
  items.push({
    ref: `form-${form.key.replace(/^isms-/, '')}`.slice(0, 40),
    kind: 'core.form',
    op: 'create',
    value: {
      key: form.key,
      name: form.name,
      description: form.description,
      icon: form.icon,
      category: form.category,
      schema: form.schema,
      workflowId: workflow ? ref(workflowRef) : null,
      audience: form.audience?.length ? { type: 'groups', groupKeys: form.audience } : { type: 'everyone' },
      active: true,
    },
  });
  return items;
}
