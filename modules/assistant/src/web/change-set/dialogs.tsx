'use client';

import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
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
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import { ArchiveIcon, CircleAlertIcon, InfoIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { type ChangeSetItem, DESTRUCTIVE_OPS } from '../../contracts';
import { ConfirmDialog } from '../confirm-dialog';
import { type ChangeSetDetailDto, changeSetApiPath, INVALIDATE } from '../lib';

/** An action's error, translated by code, with the assistant's own wording where it says more. */
export function useActionErrorText() {
  const t = useTranslations('assistant.actionErrors');
  const errorText = useErrorText();
  return useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError)) return errorText(err);
      const d = (err.details ?? {}) as { permissions?: unknown; items?: unknown };
      if (err.code === 'VALIDATION_FAILED') return t('validation');
      if (err.code === 'FORBIDDEN' && Array.isArray(d.permissions) && d.permissions.length)
        return t('forbidden', { permissions: d.permissions.join(', ') });
      if (err.code === 'CHANGE_SET_STALE' && Array.isArray(d.items) && d.items.length)
        return t('stale', {
          items: (d.items as { label?: string }[]).map((i) => `“${i.label ?? ''}”`).join(', '),
        });
      if (err.code === 'NOT_SUPPORTED') return t('notReversible');
      return errorText(err);
    },
    [t, errorText],
  );
}

type Action = 'apply' | 'submit' | 'withdraw' | 'rollback' | 'discard' | 'check' | 'refresh';

/** A change set action: refreshes the assistant's data on success; errors are shown where the action was taken. */
export function useChangeSetAction<V = void>(
  changeSetId: string,
  action: Action,
  opts: { success?: string; onDone?: () => void } = {},
) {
  return useApiMutation(
    (api, body: V) => api.post<ChangeSetDetailDto>(`${changeSetApiPath(changeSetId)}/${action}`, body ?? {}),
    { invalidate: INVALIDATE, silent: true, success: opts.success, onSuccess: () => opts.onDone?.() },
  );
}

/** Apply: one transaction with the viewer's permissions; archives and deletes need the explicit checkbox. */
export function ApplyDialog({
  detail,
  open,
  onOpenChange,
  onFailed,
}: {
  detail: ChangeSetDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFailed: () => void;
}) {
  const t = useTranslations('assistant.apply');
  const errorOf = useActionErrorText();
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  const destructive = detail.items.filter((i) => DESTRUCTIVE_OPS.includes(i.op));
  const ready = detail.ready;
  const apply = useChangeSetAction<{ confirm: boolean }>(detail.id, 'apply', {
    success: t('done', { reference: detail.reference }),
    onDone: () => onOpenChange(false),
  });
  const { reset } = apply;
  useEffect(() => {
    if (!open) return;
    setConfirmed(false);
    reset();
  }, [open, reset]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { reference: detail.reference })}
      description={t('body')}
      confirmLabel={t('confirm')}
      loading={apply.isPending}
      disabled={destructive.length > 0 && !confirmed}
      error={apply.error ? errorOf(apply.error) : null}
      onConfirm={() => apply.mutate({ confirm: destructive.length > 0 && confirmed }, { onError: onFailed })}
    >
      {detail.status === 'in_review' && (
        <p className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2 text-sm text-info">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('inReview')}
        </p>
      )}
      {!ready && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('notReady')}
        </p>
      )}
      {destructive.length > 0 && (
        <fieldset className="grid gap-3 rounded-lg border border-destructive/40 p-3">
          <legend className="px-1 text-sm font-medium text-destructive">{t('destructiveTitle')}</legend>
          <ul className="grid gap-1.5 text-sm">
            {destructive.map((i) => (
              <DestructiveItem key={i.id} item={i} />
            ))}
          </ul>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${id}-confirm`}
              checked={confirmed}
              onCheckedChange={(c) => setConfirmed(c === true)}
              className="mt-0.5"
            />
            <Label htmlFor={`${id}-confirm`} className="text-sm leading-snug font-normal">
              {t('destructiveConfirm', { count: destructive.length })}
            </Label>
          </div>
        </fieldset>
      )}
    </ConfirmDialog>
  );
}

function DestructiveItem({ item }: { item: ChangeSetItem }) {
  const t = useTranslations('assistant.ops');
  const Icon = item.op === 'delete' ? Trash2Icon : ArchiveIcon;
  return (
    <li className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 break-words">
        <span className="font-medium">{t(item.op)}:</span> {item.label}
      </span>
    </li>
  );
}

/** Request a review, with an optional note for the reviewer. */
export function SubmitDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: ChangeSetDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('assistant.submit');
  const tc = useTranslations('common');
  const errorOf = useActionErrorText();
  const id = useId();
  const [note, setNote] = useState('');
  const submit = useChangeSetAction<{ note?: string }>(detail.id, 'submit', {
    success: t('done'),
    onDone: () => onOpenChange(false),
  });
  const { reset } = submit;
  useEffect(() => {
    if (!open) return;
    setNote('');
    reset();
  }, [open, reset]);

  return (
    <Dialog open={open} onOpenChange={(o) => !submit.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { reference: detail.reference })}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate(note.trim() ? { note: note.trim() } : {});
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-note`}>{t('note')}</Label>
            <Textarea
              id={`${id}-note`}
              value={note}
              maxLength={2000}
              rows={4}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {submit.error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {errorOf(submit.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submit.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={submit.isPending}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Roll back: confirmed by this dialog, with an optional reason for the audit log. */
export function RollbackDialog({
  detail,
  open,
  onOpenChange,
  onFailed,
}: {
  detail: ChangeSetDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFailed: () => void;
}) {
  const t = useTranslations('assistant.rollback');
  const errorOf = useActionErrorText();
  const id = useId();
  const [reason, setReason] = useState('');
  const rollback = useChangeSetAction<{ confirm: true; reason?: string }>(detail.id, 'rollback', {
    success: t('done', { reference: detail.reference }),
    onDone: () => onOpenChange(false),
  });
  const { reset } = rollback;
  useEffect(() => {
    if (!open) return;
    setReason('');
    reset();
  }, [open, reset]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { reference: detail.reference })}
      description={t('body')}
      confirmLabel={t('confirm')}
      destructive
      loading={rollback.isPending}
      error={rollback.error ? errorOf(rollback.error) : null}
      onConfirm={() =>
        rollback.mutate(
          { confirm: true, ...(reason.trim() ? { reason: reason.trim() } : {}) },
          { onError: onFailed },
        )
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={1000}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

/** A plain confirmation (withdraw, discard) for an action without a body. */
export function SimpleActionDialog({
  detail,
  action,
  open,
  onOpenChange,
  destructive,
}: {
  detail: ChangeSetDetailDto;
  action: 'withdraw' | 'discard';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destructive?: boolean;
}) {
  const t = useTranslations(`assistant.${action}`);
  const errorOf = useActionErrorText();
  const mutation = useChangeSetAction(detail.id, action, {
    success: t('done', { reference: detail.reference }),
    onDone: () => onOpenChange(false),
  });
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { reference: detail.reference })}
      description={t('body')}
      confirmLabel={t('confirm')}
      destructive={destructive}
      loading={mutation.isPending}
      error={mutation.error ? errorOf(mutation.error) : null}
      onConfirm={() => mutation.mutate()}
    />
  );
}

/** Remove one proposed change from a draft. */
export function RemoveItemDialog({
  detail,
  item,
  onClose,
}: {
  detail: ChangeSetDetailDto;
  item: ChangeSetItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('assistant.item');
  const errorOf = useActionErrorText();
  const remove = useApiMutation(
    (api, itemId: string) => api.delete<ChangeSetDetailDto>(`${changeSetApiPath(detail.id)}/items/${itemId}`),
    { invalidate: INVALIDATE, silent: true, success: t('removed'), onSuccess: onClose },
  );
  const { reset } = remove;
  useEffect(() => {
    if (item) reset();
  }, [item, reset]);
  return (
    <ConfirmDialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={t('removeTitle')}
      description={item ? t('removeBody', { label: item.label, reference: detail.reference }) : undefined}
      confirmLabel={t('removeConfirm')}
      destructive
      loading={remove.isPending}
      error={remove.error ? errorOf(remove.error) : null}
      onConfirm={() => item && remove.mutate(item.id)}
    />
  );
}

/** Rename a draft and write its summary for the reviewer. */
export function EditDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: ChangeSetDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('assistant.detail');
  const tc = useTranslations('common');
  const errorOf = useActionErrorText();
  const id = useId();
  const [title, setTitle] = useState(detail.title);
  const [summary, setSummary] = useState(detail.summary);
  const save = useApiMutation(
    (api, body: { title: string; summary: string }) =>
      api.patch<ChangeSetDetailDto>(changeSetApiPath(detail.id), body),
    { invalidate: INVALIDATE, silent: true, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  const { reset } = save;
  useEffect(() => {
    if (!open) return;
    setTitle(detail.title);
    setSummary(detail.summary);
    reset();
  }, [open, reset, detail.title, detail.summary]);
  const invalid = !title.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription', { reference: detail.reference })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) save.mutate({ title: title.trim(), summary: summary.trim() });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-title`}>{t('titleLabel')}</Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={200}
              required
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-title-error` : undefined}
              onChange={(e) => setTitle(e.target.value)}
            />
            {invalid && (
              <p id={`${id}-title-error`} className="text-xs text-destructive">
                {t('titleRequired')}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-summary`}>{t('summaryLabel')}</Label>
            <Textarea
              id={`${id}-summary`}
              value={summary}
              maxLength={4000}
              rows={5}
              aria-describedby={`${id}-summary-hint`}
              onChange={(e) => setSummary(e.target.value)}
            />
            <p id={`${id}-summary-hint`} className="text-xs text-muted-foreground">
              {t('summaryHint')}
            </p>
          </div>
          {save.error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {errorOf(save.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
