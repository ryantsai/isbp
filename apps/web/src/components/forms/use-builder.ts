'use client';

import type { FormAudience, FormDetail, UpdateFormInput } from '@isbp/contracts';
import {
  type DisplayType,
  type FieldType,
  type FormElement,
  type FormAction,
  type FormRule,
  type FormSchema,
  isField,
  type LocalizedText,
} from '@isbp/sdk';
import { useCallback, useState } from 'react';
import {
  CHOICE_TYPES,
  cleanElement,
  hasText,
  newElementId,
  newRowColumn,
  slugKey,
  uniqueName,
} from '@/components/fields/field-utils';

/** Everything the builder edits locally until "Save". */
export interface BuilderState {
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  category: string;
  elements: FormElement[];
  /** Rules across fields (the Rules tab). */
  rules: FormRule[];
  /** What happens after a request is sent or decided (the Actions tab); secrets arrive as `{ set: true }`. */
  actions: FormAction[];
  workflowDefinitionId: string | null;
  audience: FormAudience;
  active: boolean;
}

export function fromDetail(form: FormDetail): BuilderState {
  return {
    name: form.name,
    description: form.description ?? {},
    icon: form.icon,
    category: form.category ?? '',
    elements: (form.draft as FormSchema).elements,
    rules: (form.draft as FormSchema).rules ?? [],
    actions: (form.draft as FormSchema).actions ?? [],
    workflowDefinitionId: form.workflow?.id ?? null,
    audience: form.audience,
    active: form.active,
  };
}

/** The schema the builder saves: cleaned elements, plus the other parts (rules, …) when there are any. */
export function toDraft(
  elements: readonly FormElement[],
  rest: Omit<FormSchema, 'elements'> = {},
): FormSchema {
  const draft: FormSchema = { elements: elements.map((el) => cleanElement(el)) };
  if (rest.rules?.length) draft.rules = rest.rules;
  if (rest.actions?.length) draft.actions = rest.actions;
  return draft;
}

export function toPatch(s: BuilderState): UpdateFormInput {
  return {
    name: s.name,
    description: hasText(s.description) ? s.description : null,
    icon: s.icon,
    category: s.category.trim() || null,
    draft: toDraft(s.elements, { rules: s.rules, actions: s.actions }),
    workflowDefinitionId: s.workflowDefinitionId,
    audience: s.audience,
    active: s.active,
  };
}

interface History<T> {
  past: T[];
  present: T;
  future: T[];
  tag: string | null;
  at: number;
}

/**
 * Undo/redo over the builder state. Consecutive edits with the same `tag` within a second are merged,
 * so typing a label is one undo step.
 */
export function useHistory<T>(initial: () => T) {
  const [h, setH] = useState<History<T>>(() => ({
    past: [],
    present: initial(),
    future: [],
    tag: null,
    at: 0,
  }));
  const update = useCallback((fn: (prev: T) => T, tag?: string) => {
    const now = Date.now();
    setH((cur) => {
      const next = fn(cur.present);
      if (next === cur.present) return cur;
      const merge = Boolean(tag) && tag === cur.tag && now - cur.at < 1000;
      return {
        past: merge ? cur.past : [...cur.past.slice(-99), cur.present],
        present: next,
        future: [],
        tag: tag ?? null,
        at: now,
      };
    });
  }, []);
  const undo = useCallback(
    () =>
      setH((cur) =>
        cur.past.length
          ? {
              past: cur.past.slice(0, -1),
              present: cur.past[cur.past.length - 1]!,
              future: [cur.present, ...cur.future],
              tag: null,
              at: 0,
            }
          : cur,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setH((cur) =>
        cur.future.length
          ? {
              past: [...cur.past, cur.present],
              present: cur.future[0]!,
              future: cur.future.slice(1),
              tag: null,
              at: 0,
            }
          : cur,
      ),
    [],
  );
  return {
    state: h.present,
    update,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}

/** A new element with sensible defaults (valid as created: label, key and options filled in). */
export function createElement(
  type: FieldType | DisplayType,
  elements: readonly FormElement[],
  text: {
    label: (type: FieldType) => string;
    option: (n: number) => string;
    heading: string;
    paragraph: string;
  },
  locale: string,
): FormElement {
  if (type === 'heading' || type === 'paragraph' || type === 'divider') {
    const id = newElementId(type === 'heading' ? 'h' : type === 'paragraph' ? 'p' : 'd');
    if (type === 'divider') return { id, type };
    return { id, type, text: { [locale]: type === 'heading' ? text.heading : text.paragraph } };
  }
  const taken = new Set(elements.filter(isField).map((f) => f.key));
  const label = text.label(type);
  const english = locale === 'en' ? slugKey(label) : '';
  const field: FormElement = {
    id: newElementId('f'),
    type,
    key: uniqueName(english || type, taken),
    label: { [locale]: label },
  };
  if (CHOICE_TYPES.includes(type))
    field.options = [1, 2, 3].map((n) => ({ value: `option${n}`, label: { [locale]: text.option(n) } }));
  // A new table starts with one text column to rename.
  if (type === 'rows') field.rows = { fields: [newRowColumn('text', [], { [locale]: text.label('text') })] };
  return field;
}

/** A copy with a fresh id and a unique key. */
export function duplicateElement(el: FormElement, elements: readonly FormElement[]): FormElement {
  if (!isField(el)) return { ...el, id: newElementId(el.type.charAt(0)) };
  const taken = new Set(elements.filter(isField).map((f) => f.key));
  return {
    ...structuredClone(el),
    id: newElementId('f'),
    key: uniqueName(el.key.replace(/\d+$/, '') || el.key, taken),
  };
}
