'use client';

import type { IdentityProvider, idpTestResultSchema } from '@isbp/contracts';
import { FormDialog } from '@isbp/ui/form-dialog';
import { RotateCcwIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import { useApiMutation } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';

type TestResult = z.input<typeof idpTestResultSchema>;

function detailValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Runs `POST /identity-providers/:id/test` as soon as it opens and shows the outcome. */
export function TestConnectionDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: IdentityProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('idp.test');
  const tc = useTranslations('common');
  const test = useApiMutation((api, id: string) => api.post<TestResult>(`/identity-providers/${id}/test`));
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !provider) {
      started.current = null;
      return;
    }
    if (started.current === provider.id) return;
    started.current = provider.id;
    test.reset();
    test.mutate(provider.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.id]);

  const result = test.data;
  const state = test.isPending
    ? 'pending'
    : result
      ? result.ok
        ? 'ok'
        : 'failed'
      : test.isError
        ? 'error'
        : 'pending';

  return (
    <FormDialog
      isOpen={open}
      onOpenChange={onOpenChange}
      title={t('title', { name: provider?.name ?? '' })}
      subtitle={t(`hint.${provider?.type ?? 'oidc'}`)}
      cancelLabel={tc('close')}
      footerStart={
        <Button
          label={t('again')}
          variant="secondary"
          icon={<Icon icon={RotateCcwIcon} />}
          isDisabled={test.isPending || !provider}
          onClick={() => provider && test.mutate(provider.id)}
        />
      }
    >
      <div aria-live="polite" className="min-h-28">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {state === 'pending' && (
              <HStack gap={3} vAlign="center">
                <Spinner size="sm" />
                <Text color="secondary">{t('running')}</Text>
              </HStack>
            )}
            {(state === 'ok' || state === 'failed') && result && (
              <>
                <Banner
                  status={state === 'ok' ? 'success' : 'error'}
                  title={state === 'ok' ? t('ok') : t('failed')}
                  collapsible={false}
                >
                  {state === 'failed' && (
                    <Text type="code" color="secondary">
                      {result.message}
                    </Text>
                  )}
                </Banner>
                {result.details && Object.keys(result.details).length > 0 && (
                  <MetadataList>
                    {Object.entries(result.details).map(([k, v]) => (
                      <MetadataListItem key={k} label={t.has(`details.${k}`) ? t(`details.${k}`) : k}>
                        <Text type="code">{detailValue(v)}</Text>
                      </MetadataListItem>
                    ))}
                  </MetadataList>
                )}
              </>
            )}
            {state === 'error' && <Banner status="error" title={t('couldNotRun')} collapsible={false} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </FormDialog>
  );
}
