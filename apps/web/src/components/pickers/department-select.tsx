'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { useDepartments } from './use-departments';

const NONE = '__none__';

/**
 * Indented department select (org tree order). `allowNone` adds a "none"/"all" option. Name it with `id` (and a
 * `<Label htmlFor>`) or `aria-label`.
 */
export function DepartmentSelect({
  value,
  onChange,
  noneLabel,
  allowNone = true,
  placeholder,
  className,
  id,
  size,
  ...aria
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  allowNone?: boolean;
  /** Shown while nothing is chosen (with `allowNone={false}`). */
  placeholder?: string;
  className?: string;
  id?: string;
  size?: 'sm' | 'default';
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  const t = useTranslations('common');
  const { ordered, byId } = useDepartments();
  // The tree indent and "└" belong to the list; the chosen value is just the name.
  const chosen = value ? byId.get(value)?.name : undefined;
  return (
    <Select value={value ?? (allowNone ? NONE : '')} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} size={size} className={className ?? 'w-full'} {...aria}>
        <SelectValue placeholder={placeholder}>
          {chosen ?? (value ? undefined : allowNone ? (noneLabel ?? t('none')) : undefined)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {allowNone && (
          <>
            <SelectItem value={NONE}>{noneLabel ?? t('none')}</SelectItem>
            <SelectSeparator />
          </>
        )}
        {ordered.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            <span style={{ paddingInlineStart: `${d.depth * 14}px` }} className="flex items-center gap-1.5">
              {d.depth > 0 && (
                <span aria-hidden className="text-muted-foreground/60">
                  └
                </span>
              )}
              {d.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
