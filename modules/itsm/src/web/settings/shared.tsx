'use client';

import { cn } from '@isbp/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { type TicketType, ticketTypeSchema } from '../../contracts';
import { TYPE_ICON } from '../components/badges';

/** Checkbox chips for a set of options (ticket types, pause statuses). */
export function CheckGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  render,
  invalid,
  describedBy,
}: {
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
  label: string;
  render: (o: T) => ReactNode;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="grid gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value.includes(o);
          return (
            <label
              key={o}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/60',
                invalid && 'border-destructive',
              )}
            >
              <Checkbox
                checked={checked}
                aria-invalid={invalid || undefined}
                onCheckedChange={(c) => onChange(c ? [...value, o] : value.filter((x) => x !== o))}
              />
              {render(o)}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function TypeChecks({
  value,
  onChange,
  label,
  invalid,
  describedBy,
}: {
  value: readonly TicketType[];
  onChange: (v: TicketType[]) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('itsm.typesPlural');
  return (
    <CheckGroup
      options={ticketTypeSchema.options}
      value={value}
      onChange={onChange}
      label={label}
      invalid={invalid}
      describedBy={describedBy}
      render={(o) => {
        const Icon = TYPE_ICON[o];
        return (
          <span className="inline-flex items-center gap-1.5">
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            {t(o)}
          </span>
        );
      }}
    />
  );
}

/** Delete with a confirmation step. */
export function DeleteButton({
  title,
  description,
  onConfirm,
  pending,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const tc = useTranslations('common');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive sm:mr-auto"
          loading={pending}
        >
          <Trash2Icon />
          {tc('delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {tc('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
