'use client';

import { Button } from '@isbp/ui/button';
import { type PersonOption, PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** A person picker bound to an id (the value forms send). */
export function PersonField({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  clearable = true,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  invalid?: boolean;
  clearable?: boolean;
}) {
  const people = usePeople(value ? [value] : []);
  const person: PersonOption | null = value ? (people.get(value) ?? { id: value, displayName: '…' }) : null;
  return (
    <PersonPicker
      id={id}
      value={person}
      onChange={(p) => onChange(p?.id ?? null)}
      placeholder={placeholder}
      invalid={invalid}
      clearable={clearable}
    />
  );
}

/** Several people: chips with a remove button, and a picker to add one more. */
export function PeoplePicker({
  id,
  value,
  onChange,
  addLabel,
}: {
  id?: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  addLabel: string;
}) {
  const t = useTranslations('isms.people');
  const people = usePeople(value);
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('selected')}>
          {value.map((personId) => {
            const name = people.get(personId)?.displayName ?? '…';
            return (
              <li
                key={personId}
                className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-sm"
              >
                <span className="max-w-48 truncate">{name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t('remove', { name })}
                  onClick={() => onChange(value.filter((v) => v !== personId))}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <PersonPicker
        id={id}
        value={null}
        excludeIds={value}
        onChange={(p) => {
          if (p && !value.includes(p.id)) onChange([...value, p.id]);
        }}
        placeholder={addLabel}
      />
    </div>
  );
}
