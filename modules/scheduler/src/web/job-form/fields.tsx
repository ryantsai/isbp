'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { isPlaceholder, type SecretValue } from '../../contracts';

/** Field errors keyed by path (`name`, `trigger.cron`, `config.url`). */
export type Errors = Record<string, string>;

export interface EditorProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** Errors of the config, keyed by config path (`url`, `headers.0.value`). */
  errors: Errors;
  disabled?: boolean;
}

/** Label + control + hint + error, wired with ids for assistive technology. */
export function FormRow({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
    labelId: string;
  }) => ReactNode;
  className?: string;
  optional?: boolean;
}) {
  const id = useId();
  const tc = useTranslations('common');
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid min-w-0 gap-2', className)}>
      <Label htmlFor={id} id={`${id}-label`} className={cn(error && 'text-destructive')}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">({tc('optional')})</span>}
      </Label>
      {children({ id, describedBy, invalid: Boolean(error), labelId: `${id}-label` })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A form section: a card with a heading the section is labelled by. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-4 rounded-xl border bg-card p-5 shadow-xs">
      <div className="-mb-1">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * A secret value: a stored one shows as "stored (hidden)" with Replace; a new one is a password field. The
 * stored value is never sent to the browser.
 */
export function SecretInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: unknown;
  onChange: (v: SecretValue) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const t = useTranslations('scheduler.secret');
  if (isPlaceholder(value) && value.set)
    return (
      <div className="flex min-w-0 gap-2">
        <Input
          id={id}
          readOnly
          value={t('stored')}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          className="min-w-0 text-muted-foreground"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          {t('replace')}
        </Button>
      </div>
    );
  return (
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      disabled={disabled}
      className="min-w-0"
    />
  );
}

export interface Pair {
  name: string;
  value: unknown;
  secret: boolean;
}

/** Name / value / secret rows (HTTP headers, script environment variables). */
export function PairsEditor({
  items,
  onChange,
  errors,
  prefix,
  labels,
  disabled,
}: {
  items: Pair[];
  onChange: (items: Pair[]) => void;
  errors: Errors;
  /** Config field (`headers`, `env`) for error paths. */
  prefix: string;
  labels: { name: string; value: string; add: string; empty: string; remove: string };
  disabled?: boolean;
}) {
  const t = useTranslations('scheduler.secret');
  const update = (i: number, patch: Partial<Pair>) =>
    onChange(items.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <div className="grid min-w-0 gap-2">
      {items.length === 0 && <p className="text-sm text-muted-foreground">{labels.empty}</p>}
      {items.map((p, i) => {
        const err = errors[`${prefix}.${i}.name`] ?? errors[`${prefix}.${i}.value`];
        return (
          <div key={i} className="grid min-w-0 gap-1">
            <div className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]">
              <Input
                value={p.name}
                onChange={(e) => update(i, { name: e.target.value })}
                aria-label={`${labels.name} ${i + 1}`}
                aria-invalid={Boolean(errors[`${prefix}.${i}.name`]) || undefined}
                className="min-w-0 font-mono text-xs"
                disabled={disabled}
              />
              {p.secret ? (
                <SecretInput
                  value={p.value}
                  onChange={(v) => update(i, { value: v })}
                  aria-label={`${labels.value} ${i + 1}`}
                  invalid={Boolean(errors[`${prefix}.${i}.value`])}
                  disabled={disabled}
                />
              ) : (
                <Input
                  value={typeof p.value === 'string' ? p.value : ''}
                  onChange={(e) => update(i, { value: e.target.value })}
                  aria-label={`${labels.value} ${i + 1}`}
                  aria-invalid={Boolean(errors[`${prefix}.${i}.value`]) || undefined}
                  className="min-w-0"
                  disabled={disabled}
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={p.secret}
                  disabled={disabled}
                  onCheckedChange={(v) =>
                    update(i, { secret: v === true, value: isPlaceholder(p.value) ? '' : p.value })
                  }
                />
                {t('secret')}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${labels.remove} ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(items.filter((_, k) => k !== i))}
              >
                <Trash2Icon />
              </Button>
            </div>
            {err && <p className="text-xs font-medium text-destructive">{err}</p>}
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...items, { name: '', value: '', secret: false }])}
        >
          <PlusIcon /> {labels.add}
        </Button>
      </div>
    </div>
  );
}

/** A number input kept as text while editing. */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  invalid,
  describedBy,
  disabled,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cn('w-full sm:w-40', className)}
    />
  );
}

/** Errors under `prefix.` with the prefix removed (`config.url` → `url`). */
export function scoped(errors: Errors, prefix: string): Errors {
  const out: Errors = {};
  for (const [k, v] of Object.entries(errors)) {
    if (k === prefix) out[''] = v;
    else if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  }
  return out;
}
