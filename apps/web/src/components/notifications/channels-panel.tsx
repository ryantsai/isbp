'use client';

import type { NotificationChannel } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Switch } from '@isbp/ui/switch';
import { Hint } from '@isbp/ui/tooltip';
import {
  CircleCheckIcon,
  CircleXIcon,
  GlobeIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RadioTowerIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        {items.length > 0 && (
          <Button onClick={() => setCreating(true)} className="shrink-0 self-start sm:self-auto">
            <PlusIcon /> {t('add')}
          </Button>
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
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t('add')}
              </Button>
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
    </div>
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
      <div className="flex items-start gap-3 p-5">
        <ChannelTile kind={c.type} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold" title={c.name}>
            {c.name}
          </h3>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">{channelLabel(c.type)}</span>
            <span aria-hidden>·</span>
            <span className="truncate font-mono" title={c.host}>
              {c.host}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={enabled ? 'text-xs font-medium text-success' : 'text-xs text-muted-foreground'}>
            {enabled ? tc('enabled') : tc('disabled')}
          </span>
          <Switch
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label={t('toggle', { name: c.name })}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-y bg-muted/20 px-5 py-3.5">
        <div className="col-span-2">
          <dt className="mb-1.5 text-[11px] text-muted-foreground">{t('subscribed')}</dt>
          <dd>
            <PatternChips patterns={c.types} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t('language')}</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 truncate text-sm">
            <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span lang={c.locale}>{localeLabel(c.locale)}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t('lastDelivery')}</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 truncate text-sm">
            <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {c.lastDeliveryAt ? <RelativeTime date={c.lastDeliveryAt} /> : <span>{t('noDelivery')}</span>}
          </dd>
        </div>
      </dl>

      <div aria-live="polite">
        <AnimatePresence initial={false}>
          {result ? (
            <motion.div
              key={result.ok ? 'ok' : 'fail'}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div
                className={
                  result.ok
                    ? 'flex items-start gap-2 border-b bg-success/8 px-5 py-3 text-sm'
                    : 'flex items-start gap-2 border-b bg-destructive/6 px-5 py-3 text-sm'
                }
              >
                {result.ok ? (
                  <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{result.ok ? t('test.sent') : t('test.failed')}</p>
                  {!result.ok && result.reason && (
                    <p className="mt-0.5 font-mono text-xs break-words text-muted-foreground">
                      {result.reason}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-my-1 size-7"
                  onClick={() => setResult(null)}
                  aria-label={tc('close')}
                >
                  <XIcon />
                </Button>
              </div>
            </motion.div>
          ) : c.lastError ? (
            <motion.div
              key="last-error"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-start gap-2 border-b px-5 py-3 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{t('lastError')}</p>
                  <p
                    className="line-clamp-2 font-mono text-xs break-words text-muted-foreground"
                    title={c.lastError}
                  >
                    {c.lastError}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 bg-muted/20 px-5 py-3">
        <Hint label={t('test.hint')}>
          <Button variant="outline" size="sm" onClick={runTest} loading={test.isPending}>
            {!test.isPending && <SendIcon />} {t('test.button')}
          </Button>
        </Hint>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={t('editLabel', { name: c.name })}>
            <PencilIcon /> {tc('edit')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('more', { name: c.name })}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2Icon /> {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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
          <li key={p}>
            <Badge variant="outline" className="max-w-full gap-1.5 bg-background font-normal" title={p}>
              {label ? (
                <span className="truncate">{label}</span>
              ) : (
                <code className="truncate font-mono text-[11px]">{p}</code>
              )}
              {reach !== null && p !== '*' && (
                <span className="text-muted-foreground tabular-nums">{t('reach', { count: reach })}</span>
              )}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
