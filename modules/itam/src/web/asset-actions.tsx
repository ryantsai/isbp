'use client';

import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { ShieldCheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { type AssetDetail, type AssetStatus, isDataBearing, RETURN_STATUSES } from '../contracts';
import { AssetStatusBadge } from './badges';
import { INVALIDATE } from './lib';

export type AssetAction = 'assign' | 'return' | 'status' | 'dispose';

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
  description?: ReactNode;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={pending} disabled={disabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={3}
        value={value}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Assign / Return / Change status / Request disposal for one asset (mounted per opening). */
export function AssetActionDialog({
  asset,
  action,
  onClose,
}: {
  asset: AssetDetail;
  action: AssetAction | null;
  onClose: () => void;
}) {
  const onOpenChange = (open: boolean) => !open && onClose();
  if (action === 'assign') return <AssignDialog asset={asset} onOpenChange={onOpenChange} />;
  if (action === 'return') return <ReturnDialog asset={asset} onOpenChange={onOpenChange} />;
  if (action === 'status') return <StatusDialog asset={asset} onOpenChange={onOpenChange} />;
  if (action === 'dispose') return <DisposeDialog asset={asset} onOpenChange={onOpenChange} />;
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
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('person')}</Label>
        <PersonPicker
          id={id}
          value={person}
          onChange={setPerson}
          placeholder={t('personPlaceholder')}
          excludeIds={asset.assignee ? [asset.assignee.id] : []}
        />
      </div>
      <NoteField value={note} onChange={setNote} label={t('note')} />
    </ActionDialog>
  );
}

function ReturnDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.actions');
  const ts = useTranslations('itam.status');
  const id = useId();
  const [toStatus, setToStatus] = useState<(typeof RETURN_STATUSES)[number]>('in_stock');
  const [note, setNote] = useState('');
  const ret = useApiMutation(
    (api, body: { toStatus: string; note: string | null }) =>
      api.post<AssetDetail>(`/itam/assets/${asset.id}/return`, body),
    {
      invalidate: INVALIDATE,
      success: (a) => t('returned', { tag: a.tag }),
      onSuccess: () => onOpenChange(false),
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
      onSubmit={() => ret.mutate({ toStatus, note: note.trim() || null })}
    >
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('returnTo')}</Label>
        <Select value={toStatus} onValueChange={(v) => setToStatus(v as typeof toStatus)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETURN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ts(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <NoteField value={note} onChange={setNote} label={t('note')} hint={t('returnNoteHint')} />
    </ActionDialog>
  );
}

function StatusDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.actions');
  const ts = useTranslations('itam.status');
  const id = useId();
  const options = asset.viewer.transitions as AssetStatus[];
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
      description={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {t('currently')} <AssetStatusBadge status={asset.status} />
        </span>
      }
      submitLabel={t('changeStatus')}
      pending={change.isPending}
      disabled={!status}
      onSubmit={() => status && change.mutate({ status, note: note.trim() || null })}
    >
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('newStatus')}</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as AssetStatus)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={t('newStatusPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s} value={s}>
                <AssetStatusBadge status={s} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {asset.assignee && status && !['deployed', 'in_repair', 'lost'].includes(status) && (
          <p className="text-xs text-muted-foreground">
            {t('releasesAssignee', { name: asset.assignee.displayName })}
          </p>
        )}
        {asset.status === 'retired' && (
          <p className="text-xs text-muted-foreground">{t('disposalViaRequest')}</p>
        )}
      </div>
      <NoteField value={note} onChange={setNote} label={t('note')} />
    </ActionDialog>
  );
}

function DisposeDialog({ asset, onOpenChange }: { asset: AssetDetail; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('itam.actions');
  const [note, setNote] = useState('');
  const dispose = useApiMutation(
    (api, body: { note: string }) => api.post<AssetDetail>(`/itam/assets/${asset.id}/dispose`, body),
    {
      invalidate: INVALIDATE,
      success: () => t('disposalRequested', { tag: asset.tag }),
      onSuccess: () => onOpenChange(false),
    },
  );
  const dataBearing = isDataBearing(asset.category);
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title={t('disposeTitle', { tag: asset.tag })}
      description={t('disposeHint')}
      submitLabel={t('requestDisposal')}
      pending={dispose.isPending}
      disabled={!note.trim()}
      onSubmit={() => dispose.mutate({ note: note.trim() })}
    >
      {dataBearing && (
        <p className="flex gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          {t('securitySignOff')}
        </p>
      )}
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
