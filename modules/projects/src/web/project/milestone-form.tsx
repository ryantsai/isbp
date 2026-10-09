'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation } from '@isbp/ui/query';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import type { ProjectDetail } from '../../contracts';
import { INVALIDATE, projectApi } from '../lib';

/**
 * Name + due date → "Add milestone", where people look (the overview's Milestones card and Settings). The button
 * stays enabled; an empty name is explained on submit.
 */
export function AddMilestoneForm({
  project,
  onAdded,
  autoFocus,
  className,
}: {
  project: ProjectDetail;
  onAdded?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useTranslations('projects.settings.milestones');
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [due, setDue] = useState('');
  const [missing, setMissing] = useState(false);
  const create = useApiMutation(
    (api, body: { name: string; dueDate: string | null }) =>
      api.post(`${projectApi(project.key)}/milestones`, body),
    {
      invalidate: INVALIDATE,
      success: t('created'),
      onSuccess: () => {
        setName('');
        setDue('');
        nameRef.current?.focus();
        onAdded?.();
      },
    },
  );
  return (
    <form
      noValidate
      className={cn('grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setMissing(true);
          nameRef.current?.focus();
          return;
        }
        create.mutate({ name: name.trim(), dueDate: due || null });
      }}
    >
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={`${id}-name`}>{t('name')}</Label>
        <Input
          ref={nameRef}
          id={`${id}-name`}
          value={name}
          maxLength={200}
          autoFocus={autoFocus}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${id}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) setMissing(false);
          }}
        />
        {missing && (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {t('nameRequired')}
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={`${id}-due`}>{t('due')}</Label>
        <Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <Button type="submit" loading={create.isPending} className="sm:mt-[1.375rem]">
        <PlusIcon />
        {t('add')}
      </Button>
    </form>
  );
}
