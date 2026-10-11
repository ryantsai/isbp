'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { DbConnectionDto, DbTestResult } from '@isbp/contracts';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import { CheckCircle2Icon, CircleDashedIcon, LockIcon, PauseCircleIcon, XCircleIcon } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';

export type DbConnection = DbConnectionDto & { lastCheckedAt: string | null };

export function EngineBadge({ engine }: { engine: DbConnection['engine'] }) {
  const t = useTranslations('databases.engines');
  return <Badge variant="neutral" label={t(engine)} />;
}

export function PurposeBadges({
  purposes,
  readOnly,
}: {
  purposes: DbConnection['purposes'];
  readOnly: boolean;
}) {
  const t = useTranslations('databases');
  return (
    <HStack gap={1} wrap="wrap" vAlign="center">
      {purposes.map((p) => (
        <Badge key={p} variant={p === 'admin' ? 'warning' : 'info'} label={t(`purposes.${p}`)} />
      ))}
      {readOnly && (
        <Badge variant="neutral" label={t('readOnly')} icon={<Icon icon={LockIcon} size="xsm" />} />
      )}
    </HStack>
  );
}

/** Status with an icon and words (never colour alone), plus when it was last checked. */
export function ConnectionStatus({ connection }: { connection: DbConnection }) {
  const t = useTranslations('databases.status');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { status, enabled, lastCheckedAt } = connection;
  const [icon, label, tone]: [typeof CheckCircle2Icon, string, StatusTone] = !enabled
    ? [PauseCircleIcon, t('disabled'), 'muted']
    : status === 'ok'
      ? [CheckCircle2Icon, t('ok'), 'success']
      : status === 'error'
        ? [XCircleIcon, t('error'), 'destructive']
        : [CircleDashedIcon, t('unknown'), 'muted'];
  return (
    <VStack gap={1} hAlign="start">
      <StatusBadge tone={tone} icon={icon} label={label} />
      {lastCheckedAt && (
        <Text type="supporting">
          {t('checked', { when: format.relativeTime(new Date(lastCheckedAt), now) })}
        </Text>
      )}
    </VStack>
  );
}

/** Outcome of "Test connection": latency and version, or the server's error code and message. */
export function TestResultNote({ result }: { result: DbTestResult }) {
  const t = useTranslations('databases.test');
  if (result.ok)
    return (
      <Banner
        status="success"
        title={t('ok', { ms: result.latencyMs ?? 0 })}
        description={result.version ? t('version', { version: result.version }) : undefined}
        collapsible={false}
      />
    );
  return (
    <Banner
      status="error"
      title={t('failed')}
      description={
        result.error?.dbCode || result.error?.message ? (
          <VStack gap={1} hAlign="start">
            {result.error?.dbCode && (
              <Text type="supporting">{t('code', { code: result.error.dbCode })}</Text>
            )}
            {result.error?.message && (
              <Text type="code" wordBreak="break-word">
                {result.error.message}
              </Text>
            )}
          </VStack>
        ) : undefined
      }
      collapsible={false}
    />
  );
}
