'use client';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { toast } from '@isbp/ui/toast';
import { CopyIcon, KeyRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOrigin, webhookPath } from '../lib';
import { WebhookHints } from './webhook-hints';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('integrations.common');
  return (
    <IconButton
      label={label}
      variant="secondary"
      icon={<Icon icon={CopyIcon} />}
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success(t('copied'));
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    />
  );
}

/** The webhook secret, once: only its hash is stored, so this is the only time anyone sees it. */
export function SecretDialog({
  open,
  onOpenChange,
  secret,
  connectionId,
  connectorType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string | null;
  connectionId: string;
  connectorType: string;
}) {
  const t = useTranslations('integrations.webhook');
  const origin = useOrigin();
  const url = `${origin}${webhookPath(connectionId)}`;
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Layout
        header={
          <DialogHeader
            startContent={<Icon icon={KeyRoundIcon} color="accent" />}
            title={t('secretTitle')}
            subtitle={t('secretDescription')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4} className="min-w-0">
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <TextInput label={t('url')} isReadOnly value={url} />
                </StackItem>
                <CopyButton value={url} label={t('copyUrl')} />
              </HStack>
              <VStack gap={2}>
                <HStack gap={2} vAlign="end">
                  <StackItem size="fill">
                    <TextInput label={t('secret')} isReadOnly value={secret ?? ''} />
                  </StackItem>
                  <CopyButton value={secret ?? ''} label={t('copySecret')} />
                </HStack>
                <Banner status="warning" title={t('once')} collapsible={false} />
              </VStack>
              <WebhookHints type={connectorType} />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={t('saved')} variant="primary" onClick={() => onOpenChange(false)} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
