'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { toast } from '@isbp/ui/toast';
import { KeyRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

const SNIPPET = `// Node.js — verify before trusting the payload
const header = req.headers['x-isbp-signature']; // "t=…,v1=…"
const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
const expected = crypto
  .createHmac('sha256', SIGNING_SECRET)
  .update(\`\${t}.\${rawBody}\`)
  .digest('hex');
const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
const valid = fresh && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));`;

const code = (chunks: ReactNode) => <Code>{chunks}</Code>;

/** Shown once after creating a generic webhook: the signing secret and how receivers verify it. */
export function SigningSecretDialog({
  open,
  onOpenChange,
  name,
  secret,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  secret: string;
}) {
  const t = useTranslations('notifications.admin.secret');
  const tc = useTranslations('common');
  // Losing the secret by a stray click would mean re-creating the channel, so only the buttons close this dialog.
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="required">
      <Layout
        header={
          <DialogHeader
            title={t('title', { name })}
            subtitle={t('description')}
            startContent={<Icon icon={KeyRoundIcon} color="accent" />}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <VStack gap={2}>
                <CodeBlock
                  code={secret}
                  isWrapped
                  width="100%"
                  hasLanguageLabel={false}
                  onCopy={() => toast.success(tc('copied'))}
                />
                <Banner status="warning" title={t('once')} collapsible={false} />
              </VStack>
              <VStack gap={2}>
                <Heading level={3}>{t('verifyTitle')}</Heading>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    <Text color="secondary">{t.rich('step1', { code })}</Text>
                  </li>
                  <li>
                    <Text color="secondary">{t.rich('step2', { code })}</Text>
                  </li>
                  <li>
                    <Text color="secondary">{t('step3')}</Text>
                  </li>
                </ol>
                <CodeBlock code={SNIPPET} language="javascript" width="100%" maxHeight={224} size="sm" />
              </VStack>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={t('done')} variant="primary" onClick={() => onOpenChange(false)} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
