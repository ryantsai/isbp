'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ApiError } from '@isbp/sdk/web';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { SparklesIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  PROJECT_HEALTHS,
  type ProjectHealth,
  type ReportingPeriodDto,
  type StatusDraft,
  type StatusUpdate,
  type StatusUpdateInput,
} from '../../contracts';
import { HealthBadge } from '../components/badges';
import { toIsoDate } from '../components/inputs';
import { dateValue, INVALIDATE, projectApi } from '../lib';
import { usePeriodLabel } from './period';

type Fields = {
  status: ProjectHealth;
  summary: string;
  done: string;
  next: string;
  blockers: string;
  asks: string;
  progress: number | null;
  forecastDate: string;
};
type FieldErrors = Partial<Record<keyof Fields | 'root', string>>;

const fromUpdate = (u: StatusUpdate | null): Fields => ({
  status: u?.status ?? 'on_track',
  summary: u?.summary ?? '',
  done: u?.done ?? '',
  next: u?.next ?? '',
  blockers: u?.blockers ?? '',
  asks: u?.asks ?? '',
  progress: u?.progress ?? null,
  forecastDate: u?.forecastDate ?? '',
});

const hasText = (f: Fields) => [f.summary, f.done, f.next, f.blockers, f.asks].some((v) => v.trim());

/**
 * Write (or change) your status update for the open period. "Draft for me" fills it from the period's tasks,
 * milestones and meetings (with AI when a model is configured); you check it and send it.
 */
export function StatusUpdateSheet({
  project,
  period,
  update,
  byManager,
  targetDate,
  open,
  onOpenChange,
}: {
  project: { key: string; name: string };
  period: ReportingPeriodDto;
  /** Your sent update when changing it; null to write one. */
  update: StatusUpdate | null;
  /** You manage the project: your update also sets its health. */
  byManager: boolean;
  targetDate: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('projects.updates');
  const tc = useTranslations('common');
  const periodLabel = usePeriodLabel();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>
            {update?.state === 'submitted'
              ? t('editTitle', { key: project.key })
              : t('writeTitle', { key: project.key })}
          </SheetTitle>
          <SheetDescription>
            {project.name} · {periodLabel(period)}
          </SheetDescription>
        </SheetHeader>
        {/* Mounted per opening, so it starts from the update as it is now. */}
        {open && (
          <UpdateForm
            project={project}
            update={update?.state === 'submitted' ? update : null}
            byManager={byManager}
            targetDate={targetDate}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function UpdateForm({
  project,
  update,
  byManager,
  targetDate,
  onDone,
}: {
  project: { key: string; name: string };
  update: StatusUpdate | null;
  byManager: boolean;
  targetDate: string | null;
  onDone: () => void;
}) {
  const t = useTranslations('projects.updates');
  const th = useTranslations('projects.health');
  const thint = useTranslations('projects.healthDialog.hint');
  const tc = useTranslations('common');
  const format = useFormatter();
  const errorText = useErrorText();
  const list = useFieldList();
  const [fields, setFields] = useState<Fields>(() => fromUpdate(update));
  const [draftMode, setDraftMode] = useState<StatusDraft['mode'] | null>(update?.draftMode ?? null);
  const [drafted, setDrafted] = useState<StatusDraft | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const draft = useApiMutation(
    (api) => api.post<StatusDraft>(`${projectApi(project.key)}/status-updates/draft`),
    {
      silent: true,
      onSuccess: (d) => {
        setDrafted(d);
        setDraftMode(d.mode);
        setErrors({});
        setFields({
          status: d.draft.status,
          summary: d.draft.summary,
          done: d.draft.done ?? '',
          next: d.draft.next ?? '',
          blockers: d.draft.blockers ?? '',
          asks: d.draft.asks ?? '',
          progress: d.draft.progress,
          forecastDate: d.draft.forecastDate ?? '',
        });
      },
    },
  );

  const save = useApiMutation(
    (api, body: StatusUpdateInput) =>
      update
        ? api.patch<StatusUpdate>(`/projects/status-updates/${update.id}`, body)
        : api.post<StatusUpdate>(`${projectApi(project.key)}/status-updates`, body),
    { invalidate: INVALIDATE, success: update ? t('saved') : t('sent'), onSuccess: onDone, silent: true },
  );

  const submit = async () => {
    const next: FieldErrors = {};
    if (!fields.summary.trim()) next.summary = t('summaryRequired');
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    const clean = (v: string) => v.trim() || null;
    try {
      await save.mutateAsync({
        status: fields.status,
        summary: fields.summary.trim(),
        done: clean(fields.done),
        next: clean(fields.next),
        blockers: clean(fields.blockers),
        asks: clean(fields.asks),
        progress: fields.progress,
        forecastDate: fields.forecastDate || null,
        draftMode,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues =
          (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        const mapped: FieldErrors = {};
        for (const i of issues) mapped[(i.path.split('.')[0] as keyof Fields) ?? 'root'] = i.message;
        setErrors(Object.keys(mapped).length ? mapped : { root: errorText(err) });
        return;
      }
      const reason =
        err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
      setErrors({
        root:
          reason === 'already_sent'
            ? t('alreadySent')
            : reason === 'period_closed'
              ? t('periodClosed')
              : errorText(err),
      });
    }
  };

  const status = (e?: string) => (e ? ({ type: 'error', message: e } as const) : undefined);
  const forecastLate = Boolean(targetDate && fields.forecastDate && fields.forecastDate > targetDate);

  return (
    <>
      <SheetForm
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SheetBody className="py-2">
          <VStack gap={4}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button
                label={t('draftForMe')}
                variant="secondary"
                icon={<Icon icon={SparklesIcon} />}
                isLoading={draft.isPending}
                onClick={() => (hasText(fields) ? setConfirmReplace(true) : draft.mutate(undefined))}
              />
              <Text type="supporting">{t('draftHint')}</Text>
            </HStack>
            {draft.error && <Banner status="error" title={errorText(draft.error)} collapsible={false} />}
            {drafted && (
              <Banner
                status="info"
                collapsible={false}
                title={
                  drafted.fallback
                    ? t('draft.fallback')
                    : drafted.mode === 'llm'
                      ? t('draft.llm')
                      : t('draft.builtin')
                }
                description={
                  drafted.sources.meetings.length > 0 ? (
                    <HStack gap={1} wrap="wrap" as="span">
                      <Text type="supporting">{t('draft.meetings')}</Text>
                      {drafted.sources.meetings.map((m) => (
                        <Link key={m.reference} href={m.href}>
                          {m.reference}
                        </Link>
                      ))}
                    </HStack>
                  ) : undefined
                }
              />
            )}
            <FormLayout defaultOptionality="optional">
              <RadioList
                label={t('status')}
                isRequired
                value={fields.status}
                onChange={(v) => set('status', v as ProjectHealth)}
                description={byManager ? t('setsHealth') : undefined}
              >
                {PROJECT_HEALTHS.map((h) => (
                  <RadioListItem
                    key={h}
                    value={h}
                    aria-label={th(h)}
                    label={<HealthBadge health={h} />}
                    description={thint(h)}
                  />
                ))}
              </RadioList>
              <TextArea
                label={t('fields.summary')}
                isRequired
                rows={3}
                maxLength={2000}
                value={fields.summary}
                description={t('fields.summaryHint')}
                status={status(errors.summary)}
                onChange={(v) => set('summary', v)}
              />
              <Grid columns={{ minWidth: 200 }} gap={3}>
                <DateInput
                  label={t('fields.forecastDate')}
                  hasClear
                  value={toIsoDate(fields.forecastDate)}
                  description={
                    targetDate
                      ? t('fields.target', {
                          date: format.dateTime(dateValue(targetDate), { dateStyle: 'medium' }),
                        })
                      : undefined
                  }
                  status={
                    errors.forecastDate
                      ? status(errors.forecastDate)
                      : forecastLate
                        ? { type: 'warning', message: t('fields.afterTarget') }
                        : undefined
                  }
                  onChange={(v) => set('forecastDate', v ?? '')}
                />
                <NumberInput
                  label={t('fields.progress')}
                  hasClear
                  min={0}
                  max={100}
                  isIntegerOnly
                  value={fields.progress}
                  status={status(errors.progress)}
                  onChange={(v) => set('progress', v ?? null)}
                />
              </Grid>
              <TextArea
                label={t('fields.done')}
                rows={4}
                maxLength={4000}
                value={fields.done}
                description={t('fields.markdownHint')}
                status={status(errors.done)}
                onChange={(v) => set('done', v)}
              />
              <TextArea
                label={t('fields.next')}
                rows={4}
                maxLength={4000}
                value={fields.next}
                status={status(errors.next)}
                onChange={(v) => set('next', v)}
              />
              <TextArea
                label={t('fields.blockers')}
                rows={3}
                maxLength={4000}
                value={fields.blockers}
                status={status(errors.blockers)}
                onChange={(v) => set('blockers', v)}
              />
              <OptionalFields hint={list([t('fields.asks')])} filled={countFilled(fields.asks.trim())}>
                <FormLayout defaultOptionality="optional">
                  <TextArea
                    label={t('fields.asks')}
                    rows={3}
                    maxLength={2000}
                    value={fields.asks}
                    description={t('fields.asksHint')}
                    status={status(errors.asks)}
                    onChange={(v) => set('asks', v)}
                  />
                </FormLayout>
              </OptionalFields>
              {errors.root && <Banner status="error" title={errors.root} collapsible={false} />}
            </FormLayout>
          </VStack>
        </SheetBody>
        <SheetFooter>
          <Button label={tc('cancel')} variant="secondary" type="button" onClick={onDone} />
          <Button
            label={update ? tc('saveChanges') : t('send')}
            variant="primary"
            isLoading={save.isPending}
            type="submit"
          />
        </SheetFooter>
      </SheetForm>
      <AlertDialog
        isOpen={confirmReplace}
        onOpenChange={setConfirmReplace}
        title={t('replaceTitle')}
        description={t('replaceBody')}
        actionLabel={t('replace')}
        cancelLabel={tc('cancel')}
        onAction={() => {
          setConfirmReplace(false);
          draft.mutate(undefined);
        }}
      />
    </>
  );
}
