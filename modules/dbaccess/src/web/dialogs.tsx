'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ApiError } from '@isbp/sdk/web';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CheckIcon, CopyIcon, EyeIcon, KeyRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Reveal } from '../contracts';
import { INVALIDATE } from './lib';

/** Asks for a reason before revoking, giving back or other irreversible actions. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
  pending?: boolean;
}) {
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form" aria-label={title}>
      {open && (
        <ReasonForm
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          pending={pending}
          onOpenChange={onOpenChange}
          onConfirm={async (reason) => {
            await onConfirm(reason);
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}

const REASON_MAX = 1_000;

function ReasonForm({
  title,
  description,
  confirmLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('dbaccess.reason');
  const tc = useTranslations('common');
  const formId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Layout
      header={<DialogHeader title={title} subtitle={description} onOpenChange={onOpenChange} />}
      content={
        <LayoutContent padding={4}>
          <form
            id={formId}
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (reason.trim().length < 3) {
                setError(t('required'));
                return;
              }
              await onConfirm(reason.trim()).catch(() => undefined);
            }}
          >
            <TextArea
              label={t('label')}
              isRequired
              rows={3}
              value={reason}
              maxLength={REASON_MAX}
              status={error ? { type: 'error', message: error } : undefined}
              onChange={(value) => {
                setReason(value.slice(0, REASON_MAX));
                setError(null);
              }}
            />
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={() => onOpenChange(false)} />
            <Button
              label={confirmLabel}
              variant="destructive"
              isLoading={pending}
              type="submit"
              form={formId}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('dbaccess.reveal');
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      variant="secondary"
      size="sm"
      label={copied ? t('copied') : label}
      icon={<Icon icon={copied ? CheckIcon : CopyIcon} />}
      onClick={async () => {
        await navigator.clipboard?.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      }}
    />
  );
}

/**
 * The one-time credential reveal: the password is fetched only when the person asks for it, shown once,
 * and never stored in the page cache.
 */
export function RevealDialog({
  revealId,
  available,
  open,
  onOpenChange,
}: {
  revealId: string;
  available: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('dbaccess.reveal');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [shown, setShown] = useState<Reveal | null>(null);
  const [gone, setGone] = useState(false);
  const reveal = useApiMutation((api) => api.post<Reveal>(`/dbaccess/reveals/${revealId}`), {
    invalidate: INVALIDATE,
    silent: true,
    onSuccess: (r) => setShown(r),
  });
  const close = (next: boolean) => {
    if (!next) {
      setShown(null);
      reveal.reset();
    }
    onOpenChange(next);
  };
  const expired =
    gone || (!available && !shown) || (reveal.error instanceof ApiError && reveal.error.status === 410);
  return (
    <Dialog isOpen={open} onOpenChange={close} width={512}>
      <Layout
        header={
          <DialogHeader
            title={t('title')}
            subtitle={t('description')}
            startContent={<Icon icon={KeyRoundIcon} color="accent" />}
            onOpenChange={close}
          />
        }
        content={
          <LayoutContent padding={4}>
            {shown ? (
              <VStack gap={3}>
                <MetadataList label={{ position: 'top' }}>
                  <MetadataListItem label={t('server')}>
                    <Text type="code" wordBreak="break-all">
                      {shown.connection.host}
                      {shown.connection.port ? `:${shown.connection.port}` : ''}
                      {shown.connection.database ? ` / ${shown.connection.database}` : ''}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label={t('account')}>
                    <HStack gap={2} vAlign="center">
                      <StackItem size="fill">
                        <Text type="code" wordBreak="break-all">
                          {shown.accountName}
                        </Text>
                      </StackItem>
                      <CopyButton value={shown.accountName} label={t('copyAccount')} />
                    </HStack>
                  </MetadataListItem>
                  <MetadataListItem label={t('password')}>
                    <HStack gap={2} vAlign="center">
                      <StackItem size="fill">
                        <span data-testid="revealed-password">
                          <Text type="code" size="base" wordBreak="break-all">
                            {shown.password}
                          </Text>
                        </span>
                      </StackItem>
                      <CopyButton value={shown.password} label={t('copyPassword')} />
                    </HStack>
                  </MetadataListItem>
                </MetadataList>
                <Banner status="warning" title={t('onceWarning')} collapsible={false} />
              </VStack>
            ) : expired ? (
              <Banner status="info" title={t('expired')} collapsible={false} />
            ) : (
              <VStack gap={3}>
                <Text>{t('confirm')}</Text>
                {reveal.error && !(reveal.error instanceof ApiError && reveal.error.status === 410) && (
                  <Banner status="error" title={errorText(reveal.error)} collapsible={false} />
                )}
              </VStack>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('close')} variant="secondary" type="button" onClick={() => close(false)} />
              {!shown && !expired && (
                <Button
                  label={t('show')}
                  variant="primary"
                  icon={<Icon icon={EyeIcon} />}
                  isLoading={reveal.isPending}
                  type="button"
                  onClick={() =>
                    reveal.mutate(undefined, {
                      onError: (err) => {
                        if (err instanceof ApiError && err.status === 410) setGone(true);
                      },
                    })
                  }
                />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
