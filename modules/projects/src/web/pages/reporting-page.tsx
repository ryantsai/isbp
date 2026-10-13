'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Divider } from '@astryxdesign/core/Divider';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { usePlatform } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { SavedIndicator } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { CalendarClockIcon, PlusIcon, SendIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import {
  CADENCES,
  type Cadence,
  DUE_WEEKDAYS,
  type ReportTemplate,
  type StatusSchedule,
  type StatusScheduleInput,
} from '../../contracts';
import { INVALIDATE } from '../lib';
import { useDueLabel, usePeriodLabel } from '../status/period';
import { TemplateSheet } from '../status/template-sheet';

const NONE = '__none__';

/** IANA zones the browser knows (falls back to a few common ones). */
function timeZones(current: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [
          'Asia/Taipei',
          'Asia/Tokyo',
          'Asia/Shanghai',
          'Asia/Singapore',
          'Europe/London',
          'America/New_York',
          'UTC',
        ];
  return all.includes(current) ? all : [current, ...all];
}

function ScheduleCard({ schedule }: { schedule: StatusSchedule }) {
  const t = useTranslations('projects.reporting');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const periodLabel = usePeriodLabel();
  const dueLabel = useDueLabel();
  const groups = useApiQuery<{ items: { id: string; key: string; name: string }[] }>(
    '/projects/lookups/groups',
  );
  const [value, setValue] = useState<StatusScheduleInput>({
    enabled: schedule.enabled,
    cadence: schedule.cadence,
    dueWeekday: schedule.dueWeekday,
    timeZone: schedule.timeZone,
    managers: schedule.managers,
    groupKey: schedule.groupKey,
    remindDaysBefore: schedule.remindDaysBefore,
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof StatusScheduleInput>(k: K, v: StatusScheduleInput[K]) => {
    setValue((x) => ({ ...x, [k]: v }));
    setError(null);
  };
  const save = useApiMutation(
    (api, body: StatusScheduleInput) => api.put<StatusSchedule>('/projects/reporting/schedule', body),
    {
      invalidate: INVALIDATE,
      success: t('saved'),
      silent: true,
      onSuccess: () => setSavedAt(Date.now()),
    },
  );
  const noReporters = value.enabled && !value.managers && !value.groupKey;
  const groupOptions = [
    { value: NONE, label: t('noGroup') },
    ...(schedule.groupKey && !groups.data?.items.some((g) => g.key === schedule.groupKey)
      ? [{ value: schedule.groupKey, label: schedule.group?.name ?? schedule.groupKey }]
      : []),
    ...(groups.data?.items ?? []).map((g) => ({ value: g.key, label: g.name })),
  ];

  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('schedule')}</CardTitle>
        <CardDescription>{t('scheduleHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (noReporters) {
              setError(t('noReporters'));
              return;
            }
            save.mutate(value, { onError: (err) => setError(errorText(err)) });
          }}
        >
          <FormLayout defaultOptionality="optional">
            <CheckboxInput
              label={t('enabled')}
              description={t('enabledHint')}
              value={value.enabled}
              onChange={(v) => set('enabled', v)}
            />
            <Grid columns={{ minWidth: 200 }} gap={3}>
              <Selector
                label={t('cadence')}
                value={value.cadence}
                onChange={(v) => set('cadence', v as Cadence)}
                options={CADENCES.map((c) => ({ value: c, label: t(`cadences.${c}`) }))}
              />
              <Selector
                label={value.cadence === 'monthly' ? t('dueMonthly') : t('dueOn')}
                value={String(value.dueWeekday)}
                onChange={(v) => set('dueWeekday', Number(v))}
                options={DUE_WEEKDAYS.map((d) => ({ value: String(d), label: t(`weekdays.${d}`) }))}
              />
              <Selector
                label={t('remind')}
                value={String(value.remindDaysBefore)}
                onChange={(v) => set('remindDaysBefore', Number(v))}
                options={[0, 1, 2, 3].map((d) => ({ value: String(d), label: t('remindDays', { days: d }) }))}
              />
              <Selector
                label={t('timeZone')}
                hasSearch
                value={value.timeZone}
                onChange={(v) => set('timeZone', v)}
                options={timeZones(value.timeZone).map((z) => ({ value: z, label: z }))}
              />
            </Grid>
            <VStack gap={2}>
              <Text type="label">{t('whoReports')}</Text>
              <CheckboxInput
                label={t('managers')}
                description={t('managersHint')}
                value={value.managers}
                onChange={(v) => set('managers', v)}
              />
              <Selector
                label={t('group')}
                description={t('groupHint')}
                hasSearch
                width={360}
                value={value.groupKey ?? NONE}
                onChange={(v) => set('groupKey', v === NONE ? null : v)}
                options={groupOptions}
              />
            </VStack>
            {value.enabled && (
              <Text type="supporting">
                {t('nextDue', { period: periodLabel(schedule.current), due: dueLabel(schedule.current.due) })}
              </Text>
            )}
            {error && <Banner status="error" title={error} collapsible={false} />}
            <HStack gap={3} vAlign="center">
              <Button label={tc('save')} variant="primary" type="submit" isLoading={save.isPending} />
              {savedAt && <SavedIndicator at={savedAt} />}
            </HStack>
          </FormLayout>
        </form>
      </CardContent>
    </Card>
  );
}

function TemplatesCard() {
  const t = useTranslations('projects.templates');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { enabledModules } = usePlatform();
  const q = useApiQuery<{ items: ReportTemplate[] }>('/projects/report-templates', { archived: 'true' });
  const [editing, setEditing] = useState<{ template: ReportTemplate | null; copyOf?: ReportTemplate } | null>(
    null,
  );
  const [archiving, setArchiving] = useState<ReportTemplate | null>(null);
  const archive = useApiMutation(
    (api, v: { template: ReportTemplate; archived: boolean }) =>
      api.post(`/projects/report-templates/${v.template.id}/${v.archived ? 'archive' : 'restore'}`, {}),
    { invalidate: INVALIDATE, success: t('archivedToast'), onSuccess: () => setArchiving(null) },
  );
  const scheduleHref = (tpl: ReportTemplate) =>
    `/scheduler/jobs/new?type=projects.status-report&name=${encodeURIComponent(
      t('jobName', { name: localize(tpl.name, locale) }),
    )}&config=${encodeURIComponent(JSON.stringify({ template: tpl.key, scope: 'all', period: 'previous', groupKeys: [], userIds: [] }))}`;

  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
        <CardAction>
          <Button
            label={t('new')}
            variant="secondary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setEditing({ template: null })}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {q.error && !q.data ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          q.data.items.map((tpl, i) => (
            <Fragment key={tpl.id}>
              {i > 0 && <Divider />}
              <HStack gap={2} vAlign="center" wrap="wrap">
                <VStack gap={0} className="min-w-0 grow">
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Text weight="medium">{localize(tpl.name, locale)}</Text>
                    <Text type="code" color="secondary">
                      {tpl.key}
                    </Text>
                    {tpl.archived && <Badge variant="neutral" label={t('archived')} />}
                  </HStack>
                  {tpl.description && <Text type="supporting">{localize(tpl.description, locale)}</Text>}
                  <Text type="supporting">{t('sectionCount', { count: tpl.sections.length })}</Text>
                </VStack>
                {!tpl.archived && (
                  <Button
                    label={tc('edit')}
                    aria-label={t('editNamed', { name: localize(tpl.name, locale) })}
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ template: tpl })}
                  />
                )}
                <MoreMenu
                  label={t('moreFor', { name: localize(tpl.name, locale) })}
                  items={[
                    { label: t('open'), href: `/projects/status-report?template=${tpl.key}` },
                    { label: t('copy'), onClick: () => setEditing({ template: null, copyOf: tpl }) },
                    ...(enabledModules.includes('scheduler') && !tpl.archived
                      ? [
                          {
                            label: t('scheduleDelivery'),
                            icon: <Icon icon={SendIcon} />,
                            href: scheduleHref(tpl),
                          },
                        ]
                      : []),
                    tpl.archived
                      ? {
                          label: t('restore'),
                          onClick: () => archive.mutate({ template: tpl, archived: false }),
                        }
                      : { label: t('archive'), onClick: () => setArchiving(tpl) },
                  ]}
                />
              </HStack>
            </Fragment>
          ))
        )}
      </CardContent>
      <TemplateSheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        template={editing?.template ?? null}
        copyOf={editing?.copyOf ?? null}
      />
      <AlertDialog
        isOpen={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t('archiveTitle', { name: archiving ? localize(archiving.name, locale) : '' })}
        description={t('archiveBody')}
        actionLabel={t('archive')}
        cancelLabel={tc('cancel')}
        isActionLoading={archive.isPending}
        onAction={() => archiving && archive.mutate({ template: archiving, archived: true })}
      />
    </Card>
  );
}

/** Administration → Project status reporting: when updates are due and who writes them, and the report's templates. */
export default function ReportingPage() {
  const t = useTranslations('projects.reporting');
  const q = useApiQuery<StatusSchedule>('/projects/reporting/schedule');
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            label={t('openReport')}
            variant="secondary"
            icon={<Icon icon={CalendarClockIcon} />}
            href="/projects/status-report"
          />
        }
      />
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} kind="page" />
      ) : !q.data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <ScheduleCard schedule={q.data} />
          <TemplatesCard />
        </div>
      )}
    </div>
  );
}
