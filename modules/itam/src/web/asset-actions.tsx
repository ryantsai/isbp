'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { localize } from '@isbp/sdk';
import { usePlatform } from '@isbp/sdk/web';
import { FormDialog } from '@isbp/ui/form-dialog';
import { Collapse } from '@isbp/ui/motion';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { SkipForwardIcon, UserCheckIcon, XCircleIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import {
  type AssetDetail,
  type AssetStatus,
  type DisposalPreview,
  type RecordWipeInput,
  RETURN_STATUSES,
  type ReturnAssetInput,
  WIPE_METHODS,
  type WipeMethod,
} from '../contracts';
import { addMonths, todayIn } from '../model';
import { ASSET_STATUS, AssetStatusBadge } from './badges';
import { INVALIDATE, useDay, useItamSettings } from './lib';

export type AssetAction = 'assign' | 'return' | 'status' | 'dispose' | 'wipe';

function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  disabled,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const tc = useTranslations('common');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled) onSubmit();
  };
  return (
    <FormDialog
      isOpen={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={description}
      onSubmit={submit}
      submitLabel={submitLabel}
      cancelLabel={tc('cancel')}
      isSubmitting={pending}
      isSubmitDisabled={disabled}
      defaultOptionality="optional"
    >
      {children}
    </FormDialog>
  );
}

function NoteField({
  value,
  onChange,
  label,
  required,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <TextArea
      label={label}
      description={hint}
      rows={3}
      value={value}
      onChange={onChange}
      isRequired={required}
      maxLength={2000}
    />
  );
}

/** A date held as `YYYY-MM-DD` text (empty = none) as the Astryx date field wants it. */
const asDate = (value: string) => (value || undefined) as ISODateString | undefined;

/** Assign / Return / Change status / Request disposal for one asset (mounted per opening). */
export function AssetActionDialog({
  asset,
  action,
  onClose,
  onNext,
}: {
  asset: AssetDetail;
  action: AssetAction | null;
  onClose: () => void;
  /** Go on with another action (Return → "Already wiped? Record it now"). */
  onNext?: (action: AssetAction) => void;
}) {
  const onOpenChange = (open: boolean) => !open && onClose();
  if (action === 'assign') return <AssignDialog asset={asset} onOpenChange={onOpenChange} />;
  if (action === 'return')
    return (
      <ReturnDialog
        asset={asset}
        onOpenChange={onOpenChange}
        onWiped={onNext ? () => onNext('wipe') : undefined}
      />
    );
  if (action === 'status') return <StatusDialog asset={asset} onOpenChange={onOpenChange} />;
  if (action === 'dispose') return <DisposeDialog asset={asset} onOpenChange={onOpenChange} />;
  if (action === 'wipe') return <WipeDialog asset={asset} onOpenChange={onOpenChange} />;
  return null;
}

function AssignDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.actions');
  const id = useId();
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [note, setNote] = useState('');
  const assign = useApiMutation(
    (api, body: { userId: string; note: string | null }) =>
      api.post<AssetDetail>(`/itam/assets/${asset.id}/assign`, body),
    {
      invalidate: INVALIDATE,
      success: (a) => t('assigned', { tag: a.tag, name: a.assignee?.displayName ?? '' }),
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title={asset.assignee ? t('reassignTitle', { tag: asset.tag }) : t('assignTitle', { tag: asset.tag })}
      description={asset.assignee ? t('reassignHint', { name: asset.assignee.displayName }) : t('assignHint')}
      submitLabel={t('assign')}
      pending={assign.isPending}
      disabled={!person}
      onSubmit={() => assign.mutate({ userId: person!.id, note: note.trim() || null })}
    >
      <Field label={t('person')} inputID={id} isRequired>
        <PersonPicker
          id={id}
          aria-label={t('person')}
          value={person}
          onChange={setPerson}
          placeholder={t('personPlaceholder')}
          excludeIds={asset.assignee ? [asset.assignee.id] : []}
        />
      </Field>
      <NoteField value={note} onChange={setNote} label={t('note')} />
    </ActionDialog>
  );
}

function ReturnDialog({
  asset,
  onOpenChange,
  onWiped,
}: {
  asset: AssetDetail;
  onOpenChange: (o: boolean) => void;
  onWiped?: () => void;
}) {
  const t = useTranslations('itam.actions');
  const ts = useTranslations('itam.status');
  const day = useDay();
  const settings = useItamSettings();
  const { user } = usePlatform();
  const [toStatus, setToStatus] = useState<(typeof RETURN_STATUSES)[number]>('in_stock');
  const [note, setNote] = useState('');
  const [scheduleWipe, setScheduleWipe] = useState(asset.dataBearing);
  const [retainUntil, setRetainUntil] = useState('');
  const [alreadyWiped, setAlreadyWiped] = useState(false);
  // The date the person will be reminded of, shown as they type (not a rule to work out).
  const wipeBy = addMonths(retainUntil || todayIn(user.timezone), settings.wipeMonths);
  const ret = useApiMutation(
    (api, body: ReturnAssetInput) => api.post<AssetDetail>(`/itam/assets/${asset.id}/return`, body),
    {
      invalidate: INVALIDATE,
      success: (a) => t('returned', { tag: a.tag }),
      onSuccess: () => (alreadyWiped && onWiped ? onWiped() : onOpenChange(false)),
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title={t('returnTitle', { tag: asset.tag })}
      description={t('returnHint', { name: asset.assignee?.displayName ?? '' })}
      submitLabel={t('return')}
      pending={ret.isPending}
      onSubmit={() =>
        ret.mutate({
          toStatus,
          note: note.trim() || null,
          scheduleWipe,
          dataRetainUntil: scheduleWipe && retainUntil ? retainUntil : null,
        })
      }
    >
      <Selector
        label={t('returnTo')}
        value={toStatus}
        onChange={(v) => setToStatus(v as typeof toStatus)}
        options={RETURN_STATUSES.map((s) => ({ value: s, label: ts(s) }))}
      />
      <CheckboxInput
        label={t('scheduleWipe')}
        description={t('scheduleWipeHint')}
        value={scheduleWipe}
        onChange={setScheduleWipe}
      />
      <Collapse open={scheduleWipe && !alreadyWiped}>
        <VStack gap={2}>
          <DateInput
            label={t('retainUntil')}
            description={t('retainUntilHint')}
            value={asDate(retainUntil)}
            onChange={(v) => setRetainUntil(v ?? '')}
          />
          <Text as="p" aria-live="polite">
            {t('wipeBy', { date: day(wipeBy), months: settings.wipeMonths })}
          </Text>
        </VStack>
      </Collapse>
      {asset.dataBearing && onWiped && (
        <CheckboxInput label={t('alreadyWiped')} value={alreadyWiped} onChange={setAlreadyWiped} />
      )}
      <NoteField value={note} onChange={setNote} label={t('note')} hint={t('returnNoteHint')} />
    </ActionDialog>
  );
}

/** "Record data wipe": when, by whom and how the storage was wiped (audited; clears the pending wipe). */
function WipeDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.wipe');
  const tm = useTranslations('itam.wipeMethod');
  const { user } = usePlatform();
  const id = useId();
  const [method, setMethod] = useState<WipeMethod | ''>(
    asset.category === 'phone' || asset.category === 'tablet' ? 'factory_reset' : '',
  );
  const [when, setWhen] = useState('');
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [note, setNote] = useState('');
  const wipe = useApiMutation(
    (api, body: RecordWipeInput) => api.post<AssetDetail>(`/itam/assets/${asset.id}/wipe`, body),
    {
      invalidate: INVALIDATE,
      success: (a) => t('recorded', { tag: a.tag }),
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title={t('title', { tag: asset.tag })}
      description={t('hint')}
      submitLabel={t('submit')}
      pending={wipe.isPending}
      disabled={!method}
      onSubmit={() =>
        method &&
        wipe.mutate({
          method,
          ...(when ? { wipedAt: new Date(when).toISOString() } : {}),
          ...(person ? { wipedById: person.id } : {}),
          note: note.trim() || null,
        })
      }
    >
      <Selector
        label={t('method')}
        isRequired
        placeholder={t('methodPlaceholder')}
        value={method || undefined}
        onChange={(v) => setMethod(v as WipeMethod)}
        options={WIPE_METHODS.map((m) => ({ value: m, label: tm(m) }))}
      />
      <DateTimeInput
        label={t('when')}
        description={t('whenHint')}
        value={(when || undefined) as ISODateTimeString | undefined}
        onChange={(v) => setWhen(v ?? '')}
      />
      <Field label={t('who')} inputID={id}>
        <PersonPicker
          id={id}
          aria-label={t('who')}
          value={person}
          onChange={setPerson}
          placeholder={user.displayName}
        />
      </Field>
      <NoteField value={note} onChange={setNote} label={t('note')} hint={t('noteHint')} />
    </ActionDialog>
  );
}

function StatusDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.actions');
  const ts = useTranslations('itam.status');
  // Deploying is "Assign" (it needs a person); disposing is "Request disposal" (it needs approval).
  const options = (asset.viewer.transitions as AssetStatus[]).filter((s) => s !== 'deployed');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [note, setNote] = useState('');
  const change = useApiMutation(
    (api, body: { status: AssetStatus; note: string | null }) =>
      api.post<AssetDetail>(`/itam/assets/${asset.id}/status`, body),
    {
      invalidate: INVALIDATE,
      success: (a) => t('statusChanged', { tag: a.tag, status: ts(a.status) }),
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title={t('statusTitle', { tag: asset.tag })}
      submitLabel={t('changeStatus')}
      pending={change.isPending}
      disabled={!status}
      onSubmit={() => status && change.mutate({ status, note: note.trim() || null })}
    >
      <HStack gap={2} vAlign="center">
        <Text>{t('currently')}</Text>
        <AssetStatusBadge status={asset.status} />
      </HStack>
      <VStack gap={2}>
        <Selector
          label={t('newStatus')}
          isRequired
          placeholder={t('newStatusPlaceholder')}
          value={status || undefined}
          onChange={(v) => setStatus(v as AssetStatus)}
          options={options.map((s) => ({ value: s, label: ts(s), icon: ASSET_STATUS[s].icon }))}
        />
        {asset.assignee && status && !['deployed', 'in_repair', 'lost'].includes(status) && (
          <Text type="supporting">{t('releasesAssignee', { name: asset.assignee.displayName })}</Text>
        )}
        {asset.status === 'retired' && <Text type="supporting">{t('disposalViaRequest')}</Text>}
      </VStack>
      <NoteField value={note} onChange={setNote} label={t('note')} />
    </ActionDialog>
  );
}

function DisposeDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.actions');
  const locale = useLocale();
  const id = useId();
  const errorText = useErrorText();
  const [note, setNote] = useState('');
  const preview = useApiQuery<DisposalPreview>(`/itam/assets/${asset.id}/disposal-preview`);
  const dispose = useApiMutation(
    (api, body: { note: string }) => api.post<AssetDetail>(`/itam/assets/${asset.id}/dispose`, body),
    {
      invalidate: INVALIDATE,
      success: () => t('disposalRequested', { tag: asset.tag }),
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title={t('disposeTitle', { tag: asset.tag })}
      description={asset.status === 'retired' ? t('disposeHint') : t('disposeRetiresHint')}
      submitLabel={t('requestDisposal')}
      pending={dispose.isPending}
      disabled={!note.trim()}
      onSubmit={() => dispose.mutate({ note: note.trim() })}
    >
      {/* A dry run of the bound disposal workflow, so the notice follows whatever the admin configured. */}
      {preview.data?.securitySignOff && (
        <Banner status="info" title={t('securitySignOff')} collapsible={false} />
      )}
      <VStack as="section" gap={2} aria-labelledby={`${id}-approvers`} aria-busy={preview.isPending}>
        <Heading level={3} id={`${id}-approvers`}>
          {t('approvers')}
        </Heading>
        {preview.isError ? (
          <Text as="p" role="alert">
            {errorText(preview.error)}
          </Text>
        ) : !preview.data ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : preview.data.steps.length ? (
          <List>
            {preview.data.steps.map((s) => (
              <ListItem
                key={s.id}
                startContent={
                  s.outcome === 'reject' ? (
                    <Icon icon={XCircleIcon} color="error" />
                  ) : s.outcome === 'ask' ? (
                    <Icon icon={UserCheckIcon} color="accent" />
                  ) : (
                    <Icon icon={SkipForwardIcon} color="secondary" />
                  )
                }
                label={localize(s.name, locale)}
                description={
                  s.outcome === 'ask'
                    ? [
                        s.people
                          .slice(0, 4)
                          .map((p) => p.displayName)
                          .join(', '),
                        s.people.length > 4 ? t('approversMore', { count: s.people.length - 4 }) : null,
                        s.people.length > 1 ? `(${t('approversAnyOf')})` : null,
                      ]
                        .filter(Boolean)
                        .join(' ')
                    : t(s.outcome === 'reject' ? 'approverReject' : 'approverNoApprover')
                }
              />
            ))}
          </List>
        ) : (
          <Text type="supporting">{t('approversNone')}</Text>
        )}
      </VStack>
      <NoteField
        value={note}
        onChange={setNote}
        label={t('disposalNote')}
        required
        hint={t('disposalNoteHint')}
      />
    </ActionDialog>
  );
}
