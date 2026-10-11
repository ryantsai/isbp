'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError } from '@isbp/sdk/web';
import { FormDialog } from '@isbp/ui/form-dialog';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { ArchiveIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { type ChangeSetItem, DESTRUCTIVE_OPS } from '../../contracts';
import { dependentsOf } from '../../lib/processes';
import { ConfirmDialog } from '../confirm-dialog';
import { type ChangeSetDetailDto, changeSetApiPath, INVALIDATE, kindInSentence } from '../lib';
import { usePermissionList } from './permission-names';

/** An action's error, translated by code, with the assistant's own wording where it says more. */
export function useActionErrorText() {
  const t = useTranslations('assistant.actionErrors');
  const errorText = useErrorText();
  const permissionList = usePermissionList();
  return useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError)) return errorText(err);
      const d = (err.details ?? {}) as { permissions?: unknown; items?: unknown };
      if (err.code === 'VALIDATION_FAILED') return t('validation');
      if (err.code === 'FORBIDDEN' && Array.isArray(d.permissions) && d.permissions.length)
        return t('forbidden', { permissions: permissionList(d.permissions as string[]) });
      if (err.code === 'CHANGE_SET_STALE' && Array.isArray(d.items) && d.items.length)
        return t('stale', {
          items: (d.items as { label?: string }[]).map((i) => `“${i.label ?? ''}”`).join(', '),
        });
      if (err.code === 'NOT_SUPPORTED') return t('notReversible');
      return errorText(err);
    },
    [t, errorText, permissionList],
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

/** Apply: everything together, with the viewer's permissions; archives and deletes need the explicit checkbox. */
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
      description={t('body', { count: detail.items.length })}
      confirmLabel={t('confirm')}
      loading={apply.isPending}
      disabled={destructive.length > 0 && !confirmed}
      error={apply.error ? errorOf(apply.error) : null}
      onConfirm={() => apply.mutate({ confirm: destructive.length > 0 && confirmed }, { onError: onFailed })}
    >
      {detail.status === 'in_review' && <Banner status="info" title={t('inReview')} collapsible={false} />}
      {!ready && <Banner status="warning" title={t('notReady')} collapsible={false} />}
      {destructive.length > 0 && (
        <Banner status="error" title={t('destructiveTitle')} collapsible={false}>
          <VStack gap={3}>
            <List density="compact">
              {destructive.map((i) => (
                <DestructiveItem key={i.id} item={i} />
              ))}
            </List>
            <CheckboxInput
              label={t('destructiveConfirm', { count: destructive.length })}
              value={confirmed}
              onChange={setConfirmed}
            />
          </VStack>
        </Banner>
      )}
    </ConfirmDialog>
  );
}

function DestructiveItem({ item }: { item: ChangeSetItem }) {
  const t = useTranslations('assistant.ops');
  const ItemIcon = item.op === 'delete' ? Trash2Icon : ArchiveIcon;
  return (
    <ListItem
      startContent={<Icon icon={ItemIcon} color="error" />}
      label={
        <>
          <Text weight="medium">{t(item.op)}:</Text> {item.label}
        </>
      }
    />
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
    <FormDialog
      isOpen={open}
      onOpenChange={(o) => !submit.isPending && onOpenChange(o)}
      title={t('title', { reference: detail.reference })}
      subtitle={t('body')}
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate(note.trim() ? { note: note.trim() } : {});
      }}
      submitLabel={t('confirm')}
      cancelLabel={tc('cancel')}
      isSubmitting={submit.isPending}
      defaultOptionality="optional"
    >
      <TextArea
        label={t('note')}
        rows={4}
        maxLength={2000}
        value={note}
        onChange={(v) => setNote(v.slice(0, 2000))}
      />
      {submit.error && <Banner status="error" title={errorOf(submit.error)} collapsible={false} />}
    </FormDialog>
  );
}

/** How many of the changes the roll back dialog lists before "and N more". */
const ROLLBACK_SHOWN = 8;

/** Roll back: says what it undoes ("Removes the request form “X”"), with an optional reason for the audit log. */
export function RollbackDialog({
  detail,
  kindLabel,
  open,
  onOpenChange,
  onFailed,
}: {
  detail: ChangeSetDetailDto;
  kindLabel: (kind: string) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFailed: () => void;
}) {
  const t = useTranslations('assistant.rollback');
  const locale = useLocale();
  // Undone in reverse order: the last change first.
  const undone = [...detail.items].sort((a, b) => b.position - a.position);
  const errorOf = useActionErrorText();
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
      <VStack gap={1}>
        <Text type="label">{t('what')}</Text>
        <List density="compact">
          {undone.slice(0, ROLLBACK_SHOWN).map((i) => (
            <ListItem
              key={i.id}
              startContent={<Icon icon={Undo2Icon} color="secondary" />}
              label={t(`undo.${i.op}`, { kind: kindInSentence(kindLabel(i.kind), locale), label: i.label })}
            />
          ))}
        </List>
        {undone.length > ROLLBACK_SHOWN && (
          <Text type="supporting">{t('more', { count: undone.length - ROLLBACK_SHOWN })}</Text>
        )}
      </VStack>
      <TextArea
        label={t('reason')}
        rows={3}
        maxLength={1000}
        value={reason}
        onChange={(v) => setReason(v.slice(0, 1000))}
      />
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

/**
 * Remove one proposed change from a draft. Changes that refer to it (a form using a workflow, a schedule assigning
 * the form) would be left broken, so they are listed and removed with it.
 */
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
  const dependents = item ? dependentsOf(detail.items, item.id) : [];
  const remove = useApiMutation(
    (api, input: { itemId: string; withDependents: boolean }) =>
      api.delete<ChangeSetDetailDto>(
        `${changeSetApiPath(detail.id)}/items/${input.itemId}${input.withDependents ? '?withDependents=true' : ''}`,
      ),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (d) => t('removed', { count: detail.items.length - d.items.length }),
      onSuccess: onClose,
    },
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
      description={
        item
          ? dependents.length
            ? t('removeWithDependents', { label: item.label, count: dependents.length })
            : t('removeBody', { label: item.label, reference: detail.reference })
          : undefined
      }
      confirmLabel={t('removeConfirm', { count: dependents.length + 1 })}
      destructive
      loading={remove.isPending}
      error={remove.error ? errorOf(remove.error) : null}
      onConfirm={() => item && remove.mutate({ itemId: item.id, withDependents: dependents.length > 0 })}
    >
      {dependents.length > 0 && (
        <List density="compact">
          {dependents.map((d) => (
            <ListItem key={d.id} startContent={<Icon icon={Trash2Icon} color="error" />} label={d.label} />
          ))}
        </List>
      )}
    </ConfirmDialog>
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
    <FormDialog
      isOpen={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={t('editTitle')}
      subtitle={t('editDescription', { reference: detail.reference })}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate({ title: title.trim(), summary: summary.trim() });
      }}
      submitLabel={tc('save')}
      cancelLabel={tc('cancel')}
      isSubmitting={save.isPending}
      defaultOptionality="optional"
    >
      <TextInput
        label={t('titleLabel')}
        isRequired
        value={title}
        onChange={(v) => setTitle(v.slice(0, 200))}
        status={invalid ? { type: 'error', message: t('titleRequired') } : undefined}
      />
      <TextArea
        label={t('summaryLabel')}
        description={t('summaryHint')}
        rows={5}
        maxLength={4000}
        value={summary}
        onChange={(v) => setSummary(v.slice(0, 4000))}
      />
      {save.error && <Banner status="error" title={errorOf(save.error)} collapsible={false} />}
    </FormDialog>
  );
}
