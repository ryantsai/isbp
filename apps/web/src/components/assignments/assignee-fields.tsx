'use client';

import { Field } from '@astryxdesign/core/Field';
import { VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import type { FormAssignmentOptions } from '@isbp/contracts';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useTranslations } from 'next-intl';

export interface AssigneeState {
  type: 'user' | 'group';
  userId: string | null;
  groupKey: string | null;
}

/** The assignee as the API takes it, or null while incomplete. */
export function assigneeInput(a: AssigneeState) {
  if (a.type === 'user') return a.userId ? { type: 'user' as const, userId: a.userId } : null;
  return a.groupKey ? { type: 'group' as const, groupKey: a.groupKey } : null;
}

/**
 * Who must fill in the form: a person (searchable picker) or a group (any member may do it). Errors are keyed like
 * the API's issue paths (`assignee.userId`, `assignee.groupKey`).
 */
export function AssigneeFields({
  id,
  value,
  onChange,
  groups,
  errors,
  disabled,
}: {
  id: string;
  value: AssigneeState;
  onChange: (value: AssigneeState) => void;
  groups: FormAssignmentOptions['groups'];
  errors?: Record<string, string | undefined>;
  disabled?: boolean;
}) {
  const t = useTranslations('assignments.dialog');
  const people = usePeople(value.userId ? [value.userId] : []);
  const person = value.userId ? (people.get(value.userId) ?? null) : null;
  const userError = errors?.['assignee.userId'] ?? (value.type === 'user' ? errors?.assignee : undefined);
  const groupError = errors?.['assignee.groupKey'] ?? (value.type === 'group' ? errors?.assignee : undefined);
  return (
    <VStack gap={3}>
      <RadioList
        label={t('assigneeType')}
        orientation="horizontal"
        value={value.type}
        isDisabled={disabled}
        onChange={(type) => onChange({ ...value, type: type === 'group' ? 'group' : 'user' })}
      >
        <RadioListItem value="user" label={t('person')} />
        <RadioListItem value="group" label={t('group')} />
      </RadioList>
      {value.type === 'user' ? (
        <Field
          label={t('personLabel')}
          inputID={`${id}-person`}
          isDisabled={disabled}
          status={userError ? { type: 'error', message: userError } : undefined}
          statusVariant="detached"
        >
          <PersonPicker
            id={`${id}-person`}
            value={person ?? (value.userId ? { id: value.userId, displayName: '…' } : null)}
            onChange={(p) => onChange({ ...value, userId: p?.id ?? null })}
            placeholder={t('pickPerson')}
            invalid={Boolean(userError)}
            disabled={disabled}
          />
        </Field>
      ) : (
        <Selector
          label={t('groupLabel')}
          value={value.groupKey ?? undefined}
          placeholder={t('pickGroup')}
          options={groups.map((g) => ({ value: g.key, label: g.name }))}
          hasSearch={groups.length > 15}
          isDisabled={disabled}
          status={groupError ? { type: 'error', message: groupError } : undefined}
          onChange={(groupKey) => onChange({ ...value, groupKey })}
        />
      )}
    </VStack>
  );
}
