'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Icon } from '@astryxdesign/core/Icon';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
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
import { ExternalLinkIcon } from 'lucide-react';
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

  const err = (key: string) => {
    const message = errors?.[key];
    return message ? { type: 'error' as const, message } : undefined;
  };
  const example = periodKey(now, period, timeZone);
  const exampleDue = format.dateTime(assignmentDueAt(now, period, due, timeZone), { dateStyle: 'medium' });

  return (
    <VStack gap={4}>
      <VStack gap={2} hAlign="start">
        <Selector
          label={t('form')}
          value={formKey || undefined}
          placeholder={isLoading ? t('loading') : t('pickForm')}
          description={t('formHint')}
          status={err('formKey')}
          hasSearch={data.forms.length > 15}
          isDisabled={disabled}
          options={data.forms.map((f) => ({
            value: f.key,
            label: `${localize(f.name, locale)}${f.published ? '' : ` · ${t('unpublished')}`}`,
            disabled: !f.published,
          }))}
          onChange={(key) => {
            const picked = data.forms.find((f) => f.key === key);
            set({
              formKey: key,
              // A sensible title once a form is picked: its name and the period.
              title: title || (picked ? `${localize(picked.name, locale)} ${TOKEN}` : title),
            });
          }}
        />
        {form && (
          <Link href={`/admin/forms/${form.id}?tab=assignments`}>
            {t('openForm', { name: localize(form.name, locale) })} <Icon icon={ExternalLinkIcon} size="sm" />
          </Link>
        )}
      </VStack>

      <AssigneeFields
        id={id}
        value={assignee}
        onChange={setAssignee}
        groups={data.groups}
        errors={errors}
        disabled={disabled}
      />

      <Grid columns={{ minWidth: 200 }} gap={4}>
        <Selector
          label={t('period')}
          value={period}
          description={t('periodHint')}
          isDisabled={disabled}
          options={ASSIGNMENT_PERIODS.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
          onChange={(p) => set({ period: p })}
        />
        <Selector
          label={t('due')}
          value={due.type}
          isDisabled={disabled}
          options={[
            { value: 'end-of-period', label: t('dueEnd') },
            { value: 'days', label: t('dueDays') },
          ]}
          onChange={(v) => set({ due: v === 'days' ? { type: 'days', days: 7 } : { type: 'end-of-period' } })}
        />
      </Grid>

      {due.type === 'days' && (
        <NumberInput
          label={t('days')}
          value={due.days}
          min={0}
          max={366}
          isIntegerOnly
          width={192}
          isDisabled={disabled}
          status={err('due.days')}
          onChange={(days) => set({ due: { type: 'days', days: Math.max(0, Math.round(days || 0)) } })}
        />
      )}

      <TextInput
        label={t('title')}
        value={title}
        description={t('titleHint', { token: TOKEN, example })}
        status={err('title')}
        isDisabled={disabled}
        onChange={(v) => set({ title: v.slice(0, 200) })}
      />

      <TextArea
        label={t('note')}
        value={note}
        rows={2}
        description={t('noteHint')}
        isDisabled={disabled}
        onChange={(v) => set({ note: v.slice(0, 2000) || null })}
      />

      {title.trim() && (
        <Banner
          status="info"
          title={t('example', { title: assignmentTitle(title, example), due: exampleDue })}
          collapsible={false}
        />
      )}
    </VStack>
  );
}
