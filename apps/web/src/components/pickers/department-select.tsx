'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { Selector, SelectorOption } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { useInputAttrs } from '@isbp/ui/lib/input-attrs';
import { useTranslations } from 'next-intl';
import { useMemo, useRef } from 'react';
import { useDepartments } from './use-departments';

const NONE = '__none__';
/** Indent per tree depth on the spacing scale. The "└" is decoration: it stays out of the option's accessible name. */
const INDENT = [0, 3, 6, 8, 10] as const;

/**
 * Indented department select (org tree order). `allowNone` adds a "none"/"all" option. Give it a visible `label` (with
 * `description` / `error`: it draws its own field frame, so no wrapping `Field`), or name it with `id` plus an external
 * `<label htmlFor>`, or with `aria-label`. Unnamed, its accessible name is "Department".
 */
export function DepartmentSelect({
  value,
  onChange,
  noneLabel,
  allowNone = true,
  placeholder,
  className,
  label,
  description,
  error,
  isRequired,
  id,
  size,
  'aria-label': ariaLabel,
  'aria-invalid': invalid,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  allowNone?: boolean;
  /** Shown while nothing is chosen (with `allowNone={false}`). */
  placeholder?: string;
  className?: string;
  /** A visible label (the select draws the field frame itself). */
  label?: string;
  description?: string;
  /** Validation message (red border + text under the field). */
  error?: string | null;
  isRequired?: boolean;
  id?: string;
  size?: 'sm' | 'default';
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  const t = useTranslations('common');
  const { ordered, byId } = useDepartments();
  const root = useRef<HTMLDivElement>(null);
  useInputAttrs(root, { id, label: label ? undefined : ariaLabel });
  const none = noneLabel ?? t('none');
  // The tree indent and "└" belong to the list; the chosen value is just the name.
  const options = useMemo(
    () => [
      ...(allowNone ? [{ value: NONE, label: none }, { type: 'divider' as const }] : []),
      ...ordered.map((d) => ({
        value: d.id,
        label: d.name,
      })),
    ],
    [allowNone, none, ordered],
  );
  const current = value ?? (allowNone ? NONE : undefined);
  return (
    <div ref={root} className={className ?? 'w-full'}>
      <Selector
        label={label ?? ariaLabel ?? t('department')}
        isLabelHidden={!label}
        description={description}
        // A searchable Selector is a button: aria-required is not allowed on it.
        isRequired={isRequired && ordered.length <= 15}
        size={size === 'sm' ? 'sm' : 'md'}
        hasSearch={ordered.length > 15}
        placeholder={placeholder}
        value={current}
        options={options}
        renderOption={(o) => {
          const d = byId.get(o.value);
          if (!d || d.depth === 0) return <SelectorOption label={o.label ?? o.value} />;
          return (
            <SelectorOption
              label={
                <HStack
                  gap={1.5}
                  vAlign="center"
                  paddingInlineStart={INDENT[Math.min(d.depth, INDENT.length - 1)]}
                >
                  <span aria-hidden>
                    <Text color="secondary">└</Text>
                  </span>
                  {d.name}
                </HStack>
              }
            />
          );
        }}
        renderValue={(o) => (o.value === NONE ? none : (byId.get(o.value)?.name ?? o.label))}
        status={error ? { type: 'error', message: error } : invalid ? { type: 'error' } : undefined}
        onChange={(v) => onChange(v === NONE ? null : v)}
      />
    </div>
  );
}
