'use client';

import {
  ASSIGNMENT_PERIODS,
  type AssignmentPeriod,
  assignmentDueAt,
  assignmentTitle,
  type FormAssignmentOptions,
  periodKey,
  type TaskConfigSlotProps,
} from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { ExternalLinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useId } from 'react';
import { useApiQuery } from '@/lib/api';
import { AssigneeFields, type AssigneeState } from './assignee-fields';

const EMPTY: FormAssignmentOptions = { forms: [], groups: [] };
const TOKEN = '{{period}}';

/**
 * Config editor of the `core.assign-form` task type in Scheduled Jobs' job form
 * (`scheduler.task-config.core.assign-form`): the form, who must fill it in, the period, the due date, the title
 * template and a note — with an example of what this period's run would open.
 */
export default function AssignFormTaskConfig({ value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('assignments.taskConfig');
  const id = useId();
  const locale = useLocale();
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'UTC';
  const now = useNow({ updateInterval: 60_000 });
  const { data = EMPTY, isLoading } = useApiQuery<FormAssignmentOptions>('/form-assignments/options');

  const formKey = typeof value.formKey === 'string' ? value.formKey : '';
  const raw = (value.assignee ?? {}) as { type?: string; userId?: string; groupKey?: string };
  const assignee: AssigneeState = {
    type: raw.type === 'group' ? 'group' : 'user',
    userId: raw.userId ?? null,
    groupKey: raw.groupKey ?? null,
  };
  const period: AssignmentPeriod = ASSIGNMENT_PERIODS.includes(value.period as AssignmentPeriod)
    ? (value.period as AssignmentPeriod)
    : 'month';
  const dueRaw = (value.due ?? {}) as { type?: string; days?: number };
  const due =
    dueRaw.type === 'days'
      ? { type: 'days' as const, days: Number.isInteger(dueRaw.days) ? dueRaw.days! : 7 }
      : { type: 'end-of-period' as const };
  const title = typeof value.title === 'string' ? value.title : '';
  const note = typeof value.note === 'string' ? value.note : '';
  const form = data.forms.find((f) => f.key === formKey);

  const set = (patch: Record<string, unknown>) => onChange({ ...value, period, due, ...patch });
  const setAssignee = (a: AssigneeState) =>
    set({
      assignee:
        a.type === 'user'
          ? { type: 'user', userId: a.userId ?? '' }
          : { type: 'group', groupKey: a.groupKey ?? '' },
    });

  const err = (key: string) => errors?.[key];
  const example = periodKey(now, period, timeZone);
  const exampleDue = format.dateTime(assignmentDueAt(now, period, due, timeZone), { dateStyle: 'medium' });

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-form`}>{t('form')}</Label>
        <Select
          value={formKey}
          onValueChange={(key) => {
            const picked = data.forms.find((f) => f.key === key);
            set({
              formKey: key,
              // A sensible title once a form is picked: its name and the period.
              title: title || (picked ? `${localize(picked.name, locale)} ${TOKEN}` : title),
            });
          }}
          disabled={disabled}
        >
          <SelectTrigger
            id={`${id}-form`}
            className="w-full"
            aria-invalid={Boolean(err('formKey')) || undefined}
            aria-describedby={`${id}-form-hint`}
          >
            <SelectValue placeholder={isLoading ? t('loading') : t('pickForm')} />
          </SelectTrigger>
          <SelectContent>
            {data.forms.map((f) => (
              <SelectItem key={f.id} value={f.key} disabled={!f.published}>
                {localize(f.name, locale)}
                {!f.published && ` · ${t('unpublished')}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${id}-form-hint`} className="text-xs text-muted-foreground">
          {err('formKey') ?? t('formHint')}
        </p>
        {form && (
          <Link
            href={`/admin/forms/${form.id}?tab=assignments`}
            className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {t('openForm', { name: localize(form.name, locale) })}
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <AssigneeFields
        id={id}
        value={assignee}
        onChange={setAssignee}
        groups={data.groups}
        errors={errors}
        disabled={disabled}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-period`}>{t('period')}</Label>
          <Select value={period} onValueChange={(p) => set({ period: p })} disabled={disabled}>
            <SelectTrigger id={`${id}-period`} className="w-full" aria-describedby={`${id}-period-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNMENT_PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`periods.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-due`}>{t('due')}</Label>
          <Select
            value={due.type}
            onValueChange={(v) =>
              set({ due: v === 'days' ? { type: 'days', days: 7 } : { type: 'end-of-period' } })
            }
            disabled={disabled}
          >
            <SelectTrigger id={`${id}-due`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="end-of-period">{t('dueEnd')}</SelectItem>
              <SelectItem value="days">{t('dueDays')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p id={`${id}-period-hint`} className="-mt-2 text-xs text-muted-foreground">
        {t('periodHint')}
      </p>

      {due.type === 'days' && (
        <div className="grid min-w-0 gap-1.5 sm:max-w-48">
          <Label htmlFor={`${id}-days`}>{t('days')}</Label>
          <Input
            id={`${id}-days`}
            type="number"
            inputMode="numeric"
            min={0}
            max={366}
            value={String(due.days)}
            onChange={(e) =>
              set({ due: { type: 'days', days: Math.max(0, Math.round(Number(e.target.value) || 0)) } })
            }
            aria-invalid={Boolean(err('due.days')) || undefined}
            disabled={disabled}
          />
          {err('due.days') && <p className="text-xs text-destructive">{err('due.days')}</p>}
        </div>
      )}

      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-title`}>{t('title')}</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          onChange={(e) => set({ title: e.target.value })}
          aria-invalid={Boolean(err('title')) || undefined}
          aria-describedby={`${id}-title-hint`}
          disabled={disabled}
        />
        <p id={`${id}-title-hint`} className="text-xs text-muted-foreground">
          {err('title') ?? t('titleHint', { token: TOKEN, example })}
        </p>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-note`}>{t('note')}</Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          maxLength={2000}
          rows={2}
          onChange={(e) => set({ note: e.target.value || null })}
          aria-describedby={`${id}-note-hint`}
          disabled={disabled}
        />
        <p id={`${id}-note-hint`} className="text-xs text-muted-foreground">
          {t('noteHint')}
        </p>
      </div>

      {title.trim() && (
        <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm [overflow-wrap:anywhere]">
          {t('example', { title: assignmentTitle(title, example), due: exampleDue })}
        </p>
      )}
    </div>
  );
}
