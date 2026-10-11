'use client';

import type { IdentityProvider } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Card } from '@isbp/ui/card';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import { PencilIcon, PlugZapIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/relative-time';
import { useApiMutation } from '@/lib/api';
import { EndpointList } from './endpoints';
import { choiceOf, IdpTypeTile } from './idp-meta';
import { useCronText } from './use-cron-text';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Switch } from '@astryxdesign/core/Switch';

function hostOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function SyncBadge({ status }: { status: string | null }) {
  const t = useTranslations('idp.sync.status');
  if (!status) return <Badge variant="neutral" label={t('never')} />;
  const tone: StatusTone = status === 'success' ? 'success' : status === 'failed' ? 'destructive' : 'info';
  return <StatusBadge tone={tone} label={t.has(status) ? t(status) : status} />;
}

/** One sign-in provider: status, key facts, LDAP sync, endpoints to register, and actions. */
export function IdpCard({
  idp,
  onEdit,
  onTest,
  onSyncQueued,
}: {
  idp: IdentityProvider;
  onEdit: () => void;
  onTest: () => void;
  onSyncQueued: () => void;
}) {
  const t = useTranslations('idp');
  const tc = useTranslations('common');
  const canManage = useCan('core.idp.manage');
  const describeCron = useCronText();
  const choice = choiceOf(idp);
  const [dialog, setDialog] = useState<'disable' | 'delete' | null>(null);

  const toggle = useApiMutation(
    (api, enabled: boolean) => api.patch<IdentityProvider>(`/identity-providers/${idp.id}`, { enabled }),
    {
      invalidate: ['/identity-providers'],
      success: (r) =>
        r.enabled ? t('toast.enabled', { name: r.name }) : t('toast.disabled', { name: r.name }),
      onSuccess: () => setDialog(null),
    },
  );
  const sync = useApiMutation((api) => api.post<{ jobId: string }>(`/identity-providers/${idp.id}/sync`), {
    success: t('toast.syncQueued', { name: idp.name }),
    onSuccess: onSyncQueued,
  });
  const remove = useApiMutation((api) => api.delete(`/identity-providers/${idp.id}`), {
    invalidate: ['/identity-providers'],
    success: t('toast.deleted', { name: idp.name }),
    onSuccess: () => setDialog(null),
  });

  const target =
    idp.type === 'oidc'
      ? hostOf(idp.config.issuer)
      : idp.type === 'saml'
        ? hostOf(idp.config.entryPoint)
        : String(idp.config.url ?? '');
  const enabled = toggle.isPending ? Boolean(toggle.variables) : idp.enabled;
  const onToggle = (next: boolean) => {
    if (!next && idp.linkedUsers > 0) setDialog('disable');
    else toggle.mutate(next);
  };

  const facts = [
    { label: t('card.linkedUsers'), value: <span className="tabular-nums">{idp.linkedUsers}</span> },
    { label: t('card.newPeople'), value: idp.jitProvisioning ? t('card.jitOn') : t('card.jitOff') },
    {
      label: t('card.groupMappings'),
      value: <span className="tabular-nums">{idp.groupMappings.length}</span>,
    },
  ];

  return (
    <Card className="h-full gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap sm:p-5">
        <IdpTypeTile choice={choice} />
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="max-w-full min-w-0 font-semibold wrap-break-word">{idp.name}</h2>
            <Badge
              variant="neutral"
              label={t(`typeLabel.${choice}`)}
              className="font-normal text-muted-foreground"
            />
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <code className="font-mono">{idp.key}</code>
            {target && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate" title={target}>
                  {target}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={enabled ? 'text-xs font-medium text-success' : 'text-xs text-muted-foreground'}>
            {enabled ? tc('enabled') : tc('disabled')}
          </span>
          <Switch
            label={t('card.toggle', { name: idp.name })}
            isLabelHidden
            value={enabled}
            isDisabled={!canManage || toggle.isPending}
            onChange={onToggle}
          />
        </div>
      </div>

      <dl className="grid grid-cols-1 divide-y border-y bg-muted/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {facts.map((f, i) => (
          <div
            key={i}
            className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-2 sm:block sm:px-5 sm:py-2.5"
          >
            <dt className="truncate text-[11px] text-muted-foreground">{f.label}</dt>
            <dd className="truncate text-sm font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>

      {idp.type === 'ldap' && (
        <div className="space-y-1.5 border-b px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t('sync.title')}</span>
            <SyncBadge status={idp.lastSyncStatus} />
            {idp.lastSyncAt && (
              <RelativeTime date={idp.lastSyncAt} className="text-xs text-muted-foreground" />
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {idp.syncEnabled ? (describeCron(idp.syncCron) ?? idp.syncCron) : t('sync.manual')}
            </span>
          </div>
          {idp.lastSyncMessage && (
            <p className="line-clamp-2 text-xs text-muted-foreground" title={idp.lastSyncMessage}>
              {idp.lastSyncMessage}
            </p>
          )}
        </div>
      )}

      {Object.keys(idp.endpoints).length > 0 && (
        <EndpointList endpoints={idp.endpoints} className="border-b px-4 py-3 sm:px-5" />
      )}

      {canManage && (
        <div className="mt-auto flex flex-wrap items-center gap-2 bg-muted/20 px-4 py-3 sm:px-5">
          <Button
            label={t('actions.test')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlugZapIcon} />}
            onClick={onTest}
          />
          {idp.type === 'ldap' && (
            <Button
              label={t('actions.sync')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={RefreshCwIcon} />}
              isLoading={sync.isPending}
              onClick={() => sync.mutate(undefined)}
            />
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              label={tc('edit')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={PencilIcon} />}
              onClick={onEdit}
            />
            <MoreMenu
              label={t('actions.more', { name: idp.name })}
              size="sm"
              items={[
                {
                  label: tc('delete'),
                  icon: Trash2Icon,
                  variant: 'destructive',
                  onClick: () => setDialog('delete'),
                },
              ]}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'disable'}
        onOpenChange={(o) => setDialog(o ? 'disable' : null)}
        title={t('disable.title', { name: idp.name })}
        description={t('disable.body', { count: idp.linkedUsers })}
        confirmLabel={t('disable.confirm')}
        destructive
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate(false)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        title={t('delete.title', { name: idp.name })}
        description={t('delete.body', { count: idp.linkedUsers })}
        confirmLabel={t('delete.confirm')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}
