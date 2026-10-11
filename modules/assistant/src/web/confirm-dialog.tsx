'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * Confirmation for an action on a change set; stays open while the action runs and shows its error (translated by
 * code) instead of closing. Assembled from `Dialog` by hand on purpose: it has to be an `alertdialog` (the
 * confirmation of an action) that also holds a body, an error and a disabled confirm, which Astryx `AlertDialog`
 * (strings only) and `FormDialog` (a plain `dialog`) don't offer.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  disabled,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  disabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(o) => !loading && onOpenChange(o)}
      width={512}
      purpose="form"
      role="alertdialog"
    >
      <Layout
        header={<DialogHeader title={title} onOpenChange={(o) => !loading && onOpenChange(o)} />}
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              {description && <Text color="secondary">{description}</Text>}
              {children}
              {error && <Banner status="error" title={error} collapsible={false} />}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                isDisabled={loading}
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={confirmLabel}
                variant={destructive ? 'destructive' : 'primary'}
                isLoading={loading}
                isDisabled={disabled}
                onClick={onConfirm}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
