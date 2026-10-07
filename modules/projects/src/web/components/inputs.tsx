'use client';

import { cn } from '@isbp/ui';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Markdown } from '@isbp/ui/markdown';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import type { Member, Milestone } from '../../contracts';

export const NONE = '__none__';

/** Free-text labels: Enter or comma adds one, Backspace on an empty input removes the last. */
export function LabelInput({
  value,
  onChange,
  id,
  placeholder,
  suggestions = [],
  invalid,
  'aria-describedby': describedBy,
}: {
  value: string[];
  onChange: (labels: string[]) => void;
  id?: string;
  placeholder?: string;
  suggestions?: readonly string[];
  invalid?: boolean;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('projects.fields');
  const listId = useId();
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const label = raw.trim().replace(/[,<>]/g, '').slice(0, 40);
    if (label && !value.includes(label) && value.length < 20) onChange([...value, label]);
    setDraft('');
  };
  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        invalid && 'border-destructive',
      )}
    >
      {value.map((label) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {label}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== label))}
            aria-label={t('removeLabel', { label })}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        list={suggestions.length ? listId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder={value.length ? undefined : placeholder}
        disabled={value.length >= 20}
        onChange={(e) => {
          const next = e.target.value;
          if (next.endsWith(',')) add(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}

/** Markdown with a Write / Preview switch (preview renders through the safe `Markdown`). */
export function MarkdownEditor({
  value,
  onChange,
  id,
  label,
  rows = 6,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Accessible name of the text area. */
  label: string;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations('projects.markdown');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'write' | 'preview')} className="gap-2">
      <TabsList>
        <TabsTrigger value="write">{t('write')}</TabsTrigger>
        <TabsTrigger value="preview">{t('preview')}</TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <Textarea
          id={id}
          aria-label={label}
          rows={rows}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-[13px]"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
      </TabsContent>
      <TabsContent value="preview" className="min-h-24 rounded-md border px-3 py-2">
        {value.trim() ? (
          <Markdown>{value}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">{t('nothing')}</p>
        )}
      </TabsContent>
    </Tabs>
  );
}

/** Assignee picker: the project's active managers and members. */
export function MemberSelect({
  members,
  value,
  onChange,
  id,
  label,
  disabled,
  allowNone = true,
  className,
}: {
  members: readonly Member[];
  value: string | null;
  onChange: (userId: string | null) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
  allowNone?: boolean;
  className?: string;
}) {
  const t = useTranslations('projects.fields');
  const options = members.filter((m) => m.active && m.role !== 'viewer');
  const current = members.find((m) => m.userId === value);
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={id ? undefined : (label ?? t('assignee'))}
        className={cn('w-full', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">{t('unassigned')}</span>
          </SelectItem>
        )}
        {current && !options.includes(current) && (
          <SelectItem value={current.userId} disabled>
            {current.displayName}
          </SelectItem>
        )}
        {options.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            <UserAvatar name={m.displayName} src={m.avatarUrl} className="size-5 text-[9px]" />
            {m.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MilestoneSelect({
  milestones,
  value,
  onChange,
  id,
  label,
  disabled,
}: {
  milestones: readonly Pick<Milestone, 'id' | 'name'>[];
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('projects.fields');
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={id ? undefined : (label ?? t('milestone'))} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{t('noMilestone')}</span>
        </SelectItem>
        {milestones.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Confirmation that stays open while the action runs. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{tc('cancel')}</AlertDialogCancel>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
