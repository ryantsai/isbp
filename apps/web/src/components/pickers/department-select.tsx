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

/** Indented department select (org tree order). `allowNone` adds a "none"/"all" option. */
export function DepartmentSelect({
  value,
  onChange,
  noneLabel,
  allowNone = true,
  className,
  id,
  size,
  ...aria
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  allowNone?: boolean;
  className?: string;
  id?: string;
  size?: 'sm' | 'default';
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  const t = useTranslations('common');
  const { ordered } = useDepartments();
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} size={size} className={className ?? 'w-full'} {...aria}>
        <SelectValue />
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
              {d.depth > 0 && <span className="text-muted-foreground/60">└</span>}
              {d.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
