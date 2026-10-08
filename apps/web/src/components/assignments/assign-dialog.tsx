'use client';

import {
  endOfLocalDay,
  type FormAssignment,
  type FormAssignmentOptions,
  type FormDetail,
  formatLocalDate,
  localDateOf,
  parseLocalDate,
} from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Textarea } from '@isbp/ui/textarea';
import { useLocale, useNow, useTimeZone, useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { AssigneeFields, type AssigneeState, assigneeInput } from './assignee-fields';

const EMPTY: FormAssignmentOptions = { forms: [], groups: [] };

/** "Assign this form" (form administrators): a person or a group, a title, a due date, an optional period and note. */
export function AssignDialog({
  form,
  open,
  onOpenChange,
}: {
  form: FormDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <AssignForm form={form} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({ form, onDone }: { form: FormDetail; onDone: () => void }) {
  const t = useTranslations('assignments.dialog');
  const tc = useTranslations('common');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow();
  const errorText = useErrorText();
  const id = useId();
  const { data: options = EMPTY } = useApiQuery<FormAssignmentOptions>('/form-assignments/options');
  const today = formatLocalDate(localDateOf(now, timeZone));
  const [assignee, setAssignee] = useState<AssigneeState>({ type: 'user', userId: null, groupKey: null });
  const [title, setTitle] = useState(localize(form.name, locale));
  const [due, setDue] = useState('');
  const [periodKey, setPeriodKey] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const create = useApiMutation(
    (api, body: Record<string, unknown>) => api.post<FormAssignment>(`/forms/${form.id}/assignments`, body),
    {
      silent: true,
      invalidate: [`/forms/${form.id}/assignments`, '/me/form-assignments'],
      success: (a) => t('assigned', { title: a.title }),
      onSuccess: onDone,
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string | undefined> = {};
    const who = assigneeInput(assignee);
    if (!who) next.assignee = assignee.type === 'user' ? t('personRequired') : t('groupRequired');
    if (!title.trim()) next.title = t('titleRequired');
    const date = parseLocalDate(due);
    if (!date) next.due = t('dueRequired');
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length || !who || !date) return;
    create.mutate(
      {
        assignee: who,
        title: title.trim(),
        dueAt: endOfLocalDay(date, timeZone).toISOString(),
        periodKey: periodKey.trim() || null,
        note: note.trim() || null,
      },
      {
        onError: (err) => {
          const issues =
            err instanceof ApiError && err.code === 'VALIDATION_FAILED'
              ? ((err.details as { issues?: { path: string; message: string }[] })?.issues ?? [])
              : [];
          if (issues.length) setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
          else setFailure(errorText(err));
        },
      },
    );
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>

      <AssigneeFields
        id={id}
        value={assignee}
        onChange={(a) => {
          setAssignee(a);
          setErrors((e) => ({ ...e, assignee: undefined }));
        }}
        groups={options.groups}
        errors={errors}
      />

      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-title`}>{t('titleLabel')}</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={Boolean(errors.title) || undefined}
          aria-describedby={`${id}-title-hint`}
        />
        <p
          id={`${id}-title-hint`}
          className={errors.title ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {errors.title ?? t('titleHint')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-due`}>{t('due')}</Label>
          <Input
            id={`${id}-due`}
            type="date"
            min={today}
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-invalid={Boolean(errors.due ?? errors.dueAt) || undefined}
            aria-describedby={`${id}-due-hint`}
            required
          />
          <p
            id={`${id}-due-hint`}
            className={
              errors.due || errors.dueAt ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
            }
          >
            {errors.due ?? errors.dueAt ?? t('dueHint', { zone: timeZone })}
          </p>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-period`}>{t('period')}</Label>
          <Input
            id={`${id}-period`}
            value={periodKey}
            maxLength={32}
            placeholder={today.slice(0, 7)}
            onChange={(e) => setPeriodKey(e.target.value)}
            aria-invalid={Boolean(errors.periodKey) || undefined}
            aria-describedby={`${id}-period-hint`}
          />
          <p
            id={`${id}-period-hint`}
            className={errors.periodKey ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
          >
            {errors.periodKey ?? t('periodHint')}
          </p>
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-note`}>{t('note')}</Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          maxLength={2000}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}

      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={create.isPending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
