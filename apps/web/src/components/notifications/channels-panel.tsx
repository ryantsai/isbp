'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import type { NotificationChannel } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Card } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  GlobeIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  RadioTowerIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/relative-time';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { ChannelFormDialog } from './channel-form';
import {
  CHANNELS_PATH,
  ChannelTile,
  localeLabel,
  typesMatching,
  useChannelLabel,
  useKnownTypes,
  usePatternLabel,
} from './notification-meta';
import { SigningSecretDialog } from './signing-secret-dialog';

export function ChannelsPanel() {
  const t = useTranslations('notifications.admin.channels');
  const { data, isLoading } = useApiQuery<{ items: NotificationChannel[] }>(CHANNELS_PATH);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<NotificationChannel | null>(null);
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);
  const items = data?.items ?? [];

  const remove = useApiMutation((api, id: string) => api.delete(`${CHANNELS_PATH}/${id}`), {
    invalidate: [CHANNELS_PATH],
    success: () => t('toast.deleted', { name: removing?.name ?? '' }),
    onSuccess: () => setRemoving(null),
  });

  return (
    <VStack gap={4}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Text color="secondary" className="max-w-2xl">
          {t('intro')}
        </Text>
        {items.length > 0 && (
          <Button
            label={t('add')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setCreating(true)}
          />
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={<RadioTowerIcon />}
            title={t('emptyTitle')}
            description={t('emptyBody')}
            action={
              <Button
                label={t('add')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setCreating(true)}
              />
            }
          />
        </Card>
      ) : (
        <motion.ul layout className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {items.map((c) => (
              <motion.li
                key={c.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
              >
                <ChannelCard channel={c} onEdit={() => setEditing(c)} onDelete={() => setRemoving(c)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <ChannelFormDialog
        open={creating || Boolean(editing)}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        channel={editing ?? undefined}
        onCreated={(c) => {
          if (c.signingSecret) setSecret({ name: c.name, secret: c.signingSecret });
        }}
      />
      <SigningSecretDialog
        open={Boolean(secret)}
        onOpenChange={(o) => !o && setSecret(null)}
        name={secret?.name ?? ''}
        secret={secret?.secret ?? ''}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('deleteTitle', { name: removing?.name ?? '' })}
        description={t('deleteBody')}
        confirmLabel={t('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </VStack>
  );
}

type TestResult = { ok: true } | { ok: false; reason: string | null };

function ChannelCard({
  channel: c,
  onEdit,
  onDelete,
}: {
  channel: NotificationChannel;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('notifications.admin.channels');
  const tc = useTranslations('common');
  const channelLabel = useChannelLabel();
  const [result, setResult] = useState<TestResult | null>(null);

  const toggle = useApiMutation(
    (api, enabled: boolean) => api.patch<NotificationChannel>(`${CHANNELS_PATH}/${c.id}`, { enabled }),
    {
      invalidate: [CHANNELS_PATH],
      success: (r) =>
        r.enabled ? t('toast.enabled', { name: r.name }) : t('toast.disabled', { name: r.name }),
    },
  );
  const test = useApiMutation((api) => api.post(`${CHANNELS_PATH}/${c.id}/test`), {
    invalidate: [CHANNELS_PATH],
    silent: true,
  });
  const runTest = async () => {
    setResult(null);
    try {
      await test.mutateAsync(undefined);
      setResult({ ok: true });
      toast.success(t('test.sentToast', { name: c.name }));
    } catch (err) {
      const reason =
        err instanceof ApiError ? ((err.details as { reason?: string } | undefined)?.reason ?? null) : null;
      setResult({ ok: false, reason: reason ?? (err instanceof Error ? err.message : null) });
      toast.error(t('test.failedToast', { name: c.name }));
    }
  };

  const enabled = toggle.isPending ? Boolean(toggle.variables) : c.enabled;

  return (
    <Card className="h-full gap-0 overflow-hidden py-0">
      <HStack gap={3} vAlign="start" className="p-4">
        <ChannelTile kind={c.type} />
        <StackItem size="fill" className="min-w-0">
          <Heading level={3} weight="semibold" maxLines={1}>
            {c.name}
          </Heading>
          <HStack gap={1.5} className="min-w-0">
            <Text type="supporting" color="secondary" className="shrink-0">
              {channelLabel(c.type)}
            </Text>
            <Text type="supporting" color="secondary" aria-hidden>
              ·
            </Text>
            <Text type="code" color="secondary" size="xsm" maxLines={1}>
              {c.host}
            </Text>
          </HStack>
        </StackItem>
        <HStack gap={2} vAlign="center" className="shrink-0">
          <Text
            type="supporting"
            color={enabled ? 'primary' : 'secondary'}
            weight={enabled ? 'medium' : 'normal'}
          >
            {enabled ? tc('enabled') : tc('disabled')}
          </Text>
          <Switch
            label={t('toggle', { name: c.name })}
            isLabelHidden
            size="sm"
            value={enabled}
            isDisabled={toggle.isPending}
            onChange={(v) => toggle.mutate(v)}
          />
        </HStack>
      </HStack>

      <Divider />
      <VStack gap={3} className="px-4 py-3">
        <VStack gap={1.5}>
          <Text type="supporting" color="secondary">
            {t('subscribed')}
          </Text>
          <PatternChips patterns={c.types} />
        </VStack>
        <MetadataList columns={2}>
          <MetadataListItem label={t('language')} icon={<Icon icon={GlobeIcon} />}>
            <span lang={c.locale}>{localeLabel(c.locale)}</span>
          </MetadataListItem>
          <MetadataListItem label={t('lastDelivery')} icon={<Icon icon={HistoryIcon} />}>
            {c.lastDeliveryAt ? <RelativeTime date={c.lastDeliveryAt} /> : <span>{t('noDelivery')}</span>}
          </MetadataListItem>
        </MetadataList>
      </VStack>

      <div aria-live="polite">
        {result ? (
          result.ok ? (
            <Banner
              status="success"
              container="section"
              title={t('test.sent')}
              isDismissable
              dismissLabel={tc('close')}
              onDismiss={() => setResult(null)}
            />
          ) : (
            <Banner
              status="error"
              container="section"
              title={t('test.failed')}
              isDismissable
              dismissLabel={tc('close')}
              onDismiss={() => setResult(null)}
              collapsible={false}
            >
              {result.reason && (
                <Text type="code" color="secondary" size="xsm">
                  {result.reason}
                </Text>
              )}
            </Banner>
          )
        ) : c.lastError ? (
          <Banner status="warning" container="section" title={t('lastError')} collapsible={false}>
            <Text type="code" color="secondary" size="xsm" maxLines={2}>
              {c.lastError}
            </Text>
          </Banner>
        ) : null}
      </div>

      <Divider />
      <HStack gap={2} vAlign="center" wrap="wrap" className="mt-auto px-4 py-3">
        <Button
          label={t('test.button')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={SendIcon} />}
          tooltip={t('test.hint')}
          isLoading={test.isPending}
          onClick={runTest}
        />
        <HStack gap={1} vAlign="center" className="ml-auto">
          <Button
            label={tc('edit')}
            aria-label={t('editLabel', { name: c.name })}
            variant="ghost"
            size="sm"
            icon={<Icon icon={PencilIcon} />}
            onClick={onEdit}
          />
          <MoreMenu
            label={t('more', { name: c.name })}
            size="sm"
            placement="below"
            alignment="end"
            items={[{ label: t('delete'), icon: Trash2Icon, variant: 'destructive', onClick: onDelete }]}
          />
        </HStack>
      </HStack>
    </Card>
  );
}

/** Subscribed patterns as chips: labelled when known, otherwise the raw pattern (with its reach). */
export function PatternChips({ patterns }: { patterns: readonly string[] }) {
  const t = useTranslations('notifications.patterns');
  const patternLabel = usePatternLabel();
  const known = useKnownTypes().map((k) => k.type);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {patterns.map((p) => {
        const label = patternLabel(p);
        const reach = p.includes('*') && known.length ? typesMatching(p, known).length : null;
        return (
          <li key={p} className="max-w-full">
            <Token
              size="sm"
              label={label ?? p}
              description={p}
              endContent={
                reach !== null && p !== '*' ? (
                  <Text type="supporting" color="secondary" size="xsm" hasTabularNumbers>
                    {t('reach', { count: reach })}
                  </Text>
                ) : undefined
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
