'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useTranslations } from 'next-intl';

/** Confirmation for deletes; stays open while the action runs. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <AlertDialog
      isOpen={open}
      onOpenChange={(next) => !loading && onOpenChange(next)}
      title={title}
      description={description ?? ''}
      actionLabel={confirmLabel}
      cancelLabel={tc('cancel')}
      actionVariant={destructive ? 'destructive' : 'primary'}
      isActionLoading={loading}
      onAction={onConfirm}
    />
  );
}
