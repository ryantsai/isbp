'use client';

import type { FormAssignmentOptions } from '@isbp/contracts';
import { Label } from '@isbp/ui/label';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
    <div className="grid min-w-0 gap-3">
      <fieldset className="grid gap-2" disabled={disabled}>
        <legend className="mb-1 text-sm font-medium">{t('assigneeType')}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(['user', 'group'] as const).map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-assignee-type`}
                value={type}
                checked={value.type === type}
                onChange={() => onChange({ ...value, type })}
                className="size-4 accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              />
              {type === 'user' ? t('person') : t('group')}
            </label>
          ))}
        </div>
      </fieldset>
      {value.type === 'user' ? (
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-person`}>{t('personLabel')}</Label>
          <PersonPicker
            id={`${id}-person`}
            value={person ?? (value.userId ? { id: value.userId, displayName: '…' } : null)}
            onChange={(p) => onChange({ ...value, userId: p?.id ?? null })}
            placeholder={t('pickPerson')}
            invalid={Boolean(userError)}
            aria-describedby={userError ? `${id}-person-error` : undefined}
            disabled={disabled}
          />
          {userError && (
            <p id={`${id}-person-error`} className="text-xs text-destructive">
              {userError}
            </p>
          )}
        </div>
      ) : (
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-group`}>{t('groupLabel')}</Label>
          <Select
            value={value.groupKey ?? ''}
            onValueChange={(groupKey) => onChange({ ...value, groupKey })}
            disabled={disabled}
          >
            <SelectTrigger
              id={`${id}-group`}
              className="w-full"
              aria-invalid={Boolean(groupError) || undefined}
              aria-describedby={groupError ? `${id}-group-error` : undefined}
            >
              <SelectValue placeholder={t('pickGroup')} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.key}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groupError && (
            <p id={`${id}-group-error`} className="text-xs text-destructive">
              {groupError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
