'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { InUseList } from '@isbp/ui/in-use';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

/**
 * Confirmation for retire/delete; stays open while the action runs.
 *
 * Built on Astryx `Dialog` with `role="alertdialog"` (what `AlertDialog` renders) because the `IN_USE` list of a
 * refused delete sits between the description and the actions, which `AlertDialog` has no slot for.
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  /** The action's error: a refused delete lists what still uses the CI (`IN_USE`). */
  error?: unknown;
}) {
  const tc = useTranslations('common');
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
              <InUseList error={error} />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end" wrap="wrap">
              {/* Cancel is the least destructive choice, so it takes the initial focus. */}
              <Button
                label={tc('cancel')}
                variant="ghost"
                isDisabled={loading}
                onClick={() => onOpenChange(false)}
                data-autofocus="true"
              />
              <Button
                label={confirmLabel}
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
