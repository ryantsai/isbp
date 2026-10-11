'use client';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Token } from '@astryxdesign/core/Token';
import { type PersonOption, PersonPicker, usePeople } from '@isbp/ui/person-picker';
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
    <VStack gap={2}>
      {value.length > 0 && (
        <HStack as="ul" gap={1.5} wrap="wrap" aria-label={t('selected')}>
          {value.map((personId) => {
            const name = people.get(personId)?.displayName ?? '…';
            return (
              <li key={personId}>
                <Token
                  label={name}
                  size="sm"
                  onRemove={() => onChange(value.filter((v) => v !== personId))}
                />
              </li>
            );
          })}
        </HStack>
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
    </VStack>
  );
}
