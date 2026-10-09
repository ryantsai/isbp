'use client';

import { Button } from '@isbp/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { BanIcon, RotateCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { Grant } from '../contracts';
import { EngineLabel, GrantStatusBadge, RiskBadge } from './badges';
import { ReasonDialog } from './dialogs';
import { INVALIDATE, requestHref, useLocalized } from './lib';

/** One grant: who, what, where, until when, its last error, and the DBA / owner actions. */
export function GrantSheet({ grantId, onClose }: { grantId: string | null; onClose: () => void }) {
  const t = useTranslations('dbaccess.grant');
  const tc = useTranslations('common');
  return (
    <Sheet open={Boolean(grantId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={tc('close')} className="sm:max-w-lg">
        {grantId ? <GrantDetail id={grantId} /> : <SheetTitle className="sr-only">{t('title')}</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}

function GrantDetail({ id }: { id: string }) {
  const t = useTranslations('dbaccess.grant');
  const ts = useTranslations('dbaccess.source');
  const te = useTranslations('dbaccess.endReason');
  const l = useLocalized();
  const [revoking, setRevoking] = useState(false);
  const { data } = useApiQuery<Grant>(`/dbaccess/grants/${id}`, undefined, { refetchInterval: 5_000 });
  const revoke = useApiMutation(
    (api, reason: string) => api.post<Grant>(`/dbaccess/grants/${id}/revoke`, { reason }),
    {
      invalidate: INVALIDATE,
      success: t('revokeStarted'),
    },
  );
  const retry = useApiMutation((api) => api.post<Grant>(`/dbaccess/grants/${id}/retry`), {
    invalidate: INVALIDATE,
    success: t('retryStarted'),
  });
  if (!data)
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Skeleton className="h-64 w-full" />
        </SheetBody>
      </>
    );
  const row = (label: string, value: ReactNode) => (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{l(data.role.name)}</SheetTitle>
        <SheetDescription>
          {data.grantee?.displayName ?? data.accountName ?? '—'} · {data.server.displayName}
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="grid gap-5 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2">
          <GrantStatusBadge status={data.viewStatus} />
          <RiskBadge risk={data.role.risk} />
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {row(t('account'), <span className="font-mono">{data.accountName ?? '—'}</span>)}
          {row(
            t('role'),
            <span className="font-mono">
              {data.role.database ? `${data.role.database}.` : ''}
              {data.role.roleName}
            </span>,
          )}
          {row(t('server'), <EngineLabel engine={data.server.engine} />)}
          {row(t('source'), ts(data.source))}
          {row(t('granted'), <DateTime date={data.grantedAt} />)}
          {row(t('expires'), data.expiresAt ? <DateTime date={data.expiresAt} /> : t('permanent'))}
          {data.endedAt && row(t('ended'), <DateTime date={data.endedAt} />)}
          {data.endReason && row(t('endReason'), te(data.endReason))}
          {data.request &&
            row(
              t('request'),
              <Link
                href={requestHref(data.request.reference)}
                className="font-mono text-primary hover:underline"
              >
                {data.request.reference}
              </Link>,
            )}
          {data.attempts > 1 && row(t('attempts'), t('retried', { count: data.attempts - 1 }))}
        </dl>
        {data.endNote && (
          <p className="rounded-lg border-l-2 border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm">
            {data.endNote}
          </p>
        )}
        {data.lastError && (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-destructive">{t('lastError')}</p>
            <pre
              tabIndex={0}
              aria-label={t('lastError')}
              className="max-h-40 overflow-auto rounded-md bg-destructive/10 p-3 text-xs whitespace-pre-wrap text-destructive"
            >
              {data.lastError}
            </pre>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {data.viewer.canRetry && (
            <Button loading={retry.isPending} onClick={() => retry.mutate(undefined)}>
              <RotateCwIcon /> {t(data.operation === 'grant' ? 'retryGrant' : 'retryRevoke')}
            </Button>
          )}
          {data.viewer.canRevoke && (
            <Button variant="destructive" onClick={() => setRevoking(true)}>
              <BanIcon /> {t('revoke')}
            </Button>
          )}
        </div>
      </SheetBody>
      <ReasonDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={t('revokeTitle')}
        description={t('revokeDescription', { person: data.grantee?.displayName ?? data.accountName ?? '' })}
        confirmLabel={t('revoke')}
        pending={revoke.isPending}
        onConfirm={(reason) => revoke.mutateAsync(reason)}
      />
    </>
  );
}
