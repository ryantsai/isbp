'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { CreatedSecret } from '@isbp/contracts';
import { CircleCheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CopyButton } from '@/components/applications/app-parts';
import { ClientExamples } from './client-parts';

/**
 * One-time reveal of a new client secret. It can't be dismissed by accident (no outside click / Esc):
 * closing requires confirming the secret was stored.
 */
export function SecretRevealDialog({
  created,
  onDone,
  rotated,
}: {
  created: CreatedSecret | null;
  onDone: () => void;
  /** A new secret for an existing client (rotation) rather than a new client. */
  rotated?: boolean;
}) {
  const t = useTranslations('applications.clients.reveal');
  const id = useId();
  const [stored, setStored] = useState(false);
  const [last, setLast] = useState(created);
  if (created && created !== last) {
    setLast(created);
    setStored(false);
  }
  const shown = created ?? last;
  if (!shown) return null;
  const { client, secret } = shown;

  return (
    <Dialog isOpen={created !== null} onOpenChange={() => {}} width={672} purpose="required">
      <Layout
        header={
          <DialogHeader
            title={rotated ? t('rotatedTitle') : t('title', { name: client.name })}
            subtitle={rotated ? t('rotatedDescription') : t('description')}
            startContent={<Icon icon={CircleCheckIcon} color="success" size="lg" />}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <Banner
                status="warning"
                title={t('warningTitle')}
                description={t('warning')}
                collapsible={false}
              />

              <VStack gap={3}>
                <div className="grid min-w-0 gap-1.5">
                  <Text type="label" id={`${id}-secret`}>
                    {t('secret')}
                  </Text>
                  <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
                    <code
                      aria-labelledby={`${id}-secret`}
                      className="min-w-0 flex-1 font-mono text-sm break-all select-all"
                      data-testid="client-secret"
                    >
                      {secret}
                    </code>
                    <CopyButton value={secret} label={t('copySecret')} variant="outline" />
                  </div>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Text type="label" id={`${id}-client`}>
                    {t('clientId')}
                  </Text>
                  <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
                    <code
                      aria-labelledby={`${id}-client`}
                      className="min-w-0 flex-1 truncate font-mono text-sm"
                      data-testid="client-id"
                    >
                      {client.clientId}
                    </code>
                    <CopyButton value={client.clientId} label={t('copyClientId')} />
                  </div>
                </div>
              </VStack>

              <VStack gap={2}>
                <Text type="label">{t('tryIt')}</Text>
                <ClientExamples client={client} secret={secret} />
              </VStack>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
              <CheckboxInput label={t('stored')} value={stored} onChange={setStored} />
              <Button label={t('done')} variant="primary" isDisabled={!stored} onClick={onDone} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
