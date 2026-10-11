'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { InUseList } from '@isbp/ui/in-use';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

/**
 * Confirmation for destructive or privileged actions; stays open while the action runs.
 *
 * Built on Astryx `Dialog` with `role="alertdialog"` (what `AlertDialog` renders) because `AlertDialog` takes plain
 * strings only and callers pass rich descriptions, extra content (`children`) and the `IN_USE` list of a refused delete.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  /** The action's error: a refused delete lists what still uses the thing (`IN_USE`). */
  error?: unknown;
  children?: ReactNode;
}) {
  const t = useTranslations('common');
  const descriptionId = useId();
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      width={400}
      purpose="form"
      role="alertdialog"
      aria-describedby={description ? descriptionId : undefined}
    >
      <Layout
        header={<DialogHeader title={title} hasDivider={false} />}
        content={
          <LayoutContent>
            <VStack gap={3}>
              {description && (
                <Text id={descriptionId} color="secondary">
                  {description}
                </Text>
              )}
              {children}
              <InUseList error={error} />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end" wrap="wrap">
              {/* Cancel is the least destructive choice, so it takes the initial focus. */}
              <Button
                label={t('cancel')}
                variant="ghost"
                isDisabled={loading}
                onClick={() => onOpenChange(false)}
                data-autofocus="true"
              />
              <Button
                label={confirmLabel ?? t('confirm')}
                variant={destructive ? 'destructive' : 'primary'}
                isLoading={loading}
                onClick={onConfirm}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
