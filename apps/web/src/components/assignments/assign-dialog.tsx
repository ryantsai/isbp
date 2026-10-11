'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
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
  const t = useTranslations('assignments.dialog');
  // The header mounts after the dialog opens, so name the dialog here (Astryx reads the title only at mount).
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form" aria-label={t('title')}>
      {open && <AssignForm form={form} onDone={() => onOpenChange(false)} />}
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
  const [due, setDue] = useState<ISODateString | undefined>();
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
    const date = parseLocalDate(due ?? '');
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

  const dueError = errors.due ?? errors.dueAt;
  return (
    <Layout
      header={<DialogHeader title={t('title')} subtitle={t('description')} onOpenChange={() => onDone()} />}
      content={
        <LayoutContent padding={4}>
          <form id={id} noValidate onSubmit={submit}>
            <FormLayout defaultOptionality="optional">
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

              <TextInput
                label={t('titleLabel')}
                isRequired
                value={title}
                description={t('titleHint')}
                status={errors.title ? { type: 'error', message: errors.title } : undefined}
                onChange={(v) => setTitle(v.slice(0, 300))}
              />

              <Grid columns={{ minWidth: 200 }} gap={4}>
                <DateInput
                  label={t('due')}
                  isRequired
                  min={today as ISODateString}
                  value={due}
                  description={t('dueHint', { zone: timeZone })}
                  status={dueError ? { type: 'error', message: dueError } : undefined}
                  onChange={setDue}
                />
                <TextInput
                  label={t('period')}
                  value={periodKey}
                  placeholder={today.slice(0, 7)}
                  description={t('periodHint')}
                  status={errors.periodKey ? { type: 'error', message: errors.periodKey } : undefined}
                  onChange={(v) => setPeriodKey(v.slice(0, 32))}
                />
              </Grid>

              <TextArea label={t('note')} rows={3} value={note} onChange={(v) => setNote(v.slice(0, 2000))} />

              {failure && <Banner status="error" title={failure} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button
              label={tc('cancel')}
              variant="ghost"
              isDisabled={create.isPending}
              type="button"
              onClick={onDone}
            />
            <Button
              label={t('submit')}
              variant="primary"
              isLoading={create.isPending}
              type="submit"
              form={id}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
