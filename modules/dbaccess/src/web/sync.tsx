'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { ApiError } from '@isbp/sdk/web';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { toast } from '@isbp/ui/toast';
import { RefreshCwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SyncResult } from '../contracts';
import { INVALIDATE } from './lib';

/** "Sync now": reads the server's accounts, roles and memberships; DBAs see the server's own error. */
export function SyncButton({
  serverId,
  name,
  size = 'sm',
}: {
  serverId: string;
  name: string;
  size?: 'sm' | 'default';
}) {
  const t = useTranslations('dbaccess.sync');
  const errorText = useErrorText();
  const sync = useApiMutation((api) => api.post<SyncResult>(`/dbaccess/servers/${serverId}/sync`), {
    invalidate: INVALIDATE,
    silent: true,
    onSuccess: (r) =>
      toast.success(t('done', { name, accounts: r.accounts, roles: r.roles, unmanaged: r.unmanaged })),
  });
  return (
    <Button
      size={size === 'sm' ? 'sm' : 'md'}
      variant="secondary"
      isLoading={sync.isPending}
      icon={<Icon icon={RefreshCwIcon} />}
      label={t('nowFor', { name })}
      onClick={() =>
        sync.mutate(undefined, {
          onError: (err) => {
            const detail =
              err instanceof ApiError && err.code === 'DATABASE_ERROR'
                ? (err.details as { message?: string } | undefined)?.message
                : null;
            toast.error(detail ? t('failed', { name, message: detail }) : errorText(err));
          },
        })
      }
    >
      {t('now')}
    </Button>
  );
}
