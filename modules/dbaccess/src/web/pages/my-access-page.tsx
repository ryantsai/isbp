'use client';

import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowRightIcon,
  CalendarClockIcon,
  DatabaseIcon,
  HistoryIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Undo2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Grant, MyAccess, ServerOption } from '../../contracts';
import { EngineLabel, GrantStatusBadge, RequestStatusBadge, RiskBadge } from '../badges';
import { ReasonDialog, RevealDialog } from '../dialogs';
import { GrantsTable } from '../grants-table';
import { INVALIDATE, requestHref, useDate, useDay, useLocalized } from '../lib';

const LIVE = new Set(['provisioning', 'active', 'revoking', 'failed']);

function GrantCard({ grant }: { grant: Grant }) {
  const t = useTranslations('dbaccess.mine');
  const l = useLocalized();
  const date = useDate();
  const [revealOpen, setRevealOpen] = useState(false);
  const [giveBack, setGiveBack] = useState(false);
  const relinquish = useApiMutation(
    (api, reason: string) => api.post(`/dbaccess/grants/${grant.id}/relinquish`, { reason }),
    { invalidate: INVALIDATE, success: t('relinquished') },
  );
  const headingId = `dbaccess-grant-${grant.id}`;
  return (
    <Card className="h-full min-w-0 gap-4">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <GrantStatusBadge status={grant.viewStatus} />
          <RiskBadge risk={grant.role.risk} />
        </div>
        <CardTitle id={headingId} className="min-w-0 text-base">
          <span className="block truncate">{l(grant.role.name)}</span>
        </CardTitle>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="truncate">{grant.server.displayName}</span>
          <EngineLabel engine={grant.server.engine} />
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('account')}</dt>
            <dd className="truncate font-mono">{grant.accountName ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('role')}</dt>
            <dd className="truncate font-mono">
              {grant.role.database ? `${grant.role.database}.` : ''}
              {grant.role.roleName}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('until')}</dt>
            <dd className="flex items-center gap-1">
              <CalendarClockIcon className="size-3.5 text-muted-foreground" aria-hidden />
              {grant.expiresAt ? date(grant.expiresAt) : t('permanent')}
            </dd>
          </div>
          {grant.request && (
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t('requestRef')}</dt>
              <dd>
                <Link href={requestHref(grant.request.reference)} className="font-mono hover:underline">
                  {grant.request.reference}
                </Link>
              </dd>
            </div>
          )}
        </dl>
        {grant.status === 'failed' && <p className="text-sm text-destructive">{t('failedHint')}</p>}
        {grant.status === 'provisioning' && (
          <p className="text-sm text-muted-foreground">{t('provisioningHint')}</p>
        )}
      </CardContent>
      {(grant.reveal || grant.viewer.canExtend || grant.viewer.canRelinquish) && (
        <CardFooter className="mt-auto flex flex-wrap gap-2">
          {grant.reveal && (
            <Button
              size="sm"
              variant={grant.reveal.available ? 'default' : 'outline'}
              onClick={() => setRevealOpen(true)}
            >
              <KeyRoundIcon />
              {grant.reveal.available ? t('revealPassword') : t('passwordShown')}
            </Button>
          )}
          {grant.viewer.canExtend && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/dbaccess/request?extend=${grant.id}`}>
                <RefreshCwIcon /> {t('extend')}
              </Link>
            </Button>
          )}
          {grant.viewer.canRelinquish && (
            <Button size="sm" variant="ghost" onClick={() => setGiveBack(true)}>
              <Undo2Icon /> {t('relinquish')}
            </Button>
          )}
        </CardFooter>
      )}
      {grant.reveal && (
        <RevealDialog
          revealId={grant.reveal.id}
          available={grant.reveal.available}
          open={revealOpen}
          onOpenChange={setRevealOpen}
        />
      )}
      <ReasonDialog
        open={giveBack}
        onOpenChange={setGiveBack}
        title={t('relinquishTitle', { role: l(grant.role.name) })}
        description={t('relinquishDescription')}
        confirmLabel={t('relinquish')}
        pending={relinquish.isPending}
        onConfirm={(reason) => relinquish.mutateAsync(reason)}
      />
    </Card>
  );
}

/**
 * "Access to roles you own": who holds the roles the person (or their group) owns, scoped by the API to those
 * roles. A row opens the grant, where the owner may revoke it early.
 */
function OwnedAccess() {
  const t = useTranslations('dbaccess.mine.owned');
  const servers = useApiQuery<{ items: ServerOption[] }>('/dbaccess/lookups/servers');
  return (
    <section aria-labelledby="dbaccess-owned" className="grid min-w-0 gap-3">
      <div className="grid gap-1">
        <h2 id="dbaccess-owned" className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <GrantsTable owned servers={servers.data?.items ?? []} />
    </section>
  );
}

/** "My database access": what I hold, what I asked for, the one-time password reveals, and roles I own. */
export default function MyAccessPage() {
  const t = useTranslations('dbaccess.mine');
  const te = useTranslations('dbaccess.endReason');
  const l = useLocalized();
  const day = useDay();
  const { data, isLoading } = useApiQuery<MyAccess>('/dbaccess/me/access', undefined, {
    refetchInterval: 15_000,
  });
  const live = data?.grants.filter((g) => LIVE.has(g.status)) ?? [];
  const ended = data?.grants.filter((g) => !LIVE.has(g.status)) ?? [];
  const pending = data?.requests.filter((r) => r.status === 'pending') ?? [];
  const decided = data?.requests.filter((r) => r.status === 'rejected' || r.status === 'cancelled') ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/dbaccess/request">
              <PlusIcon /> {t('request')}
            </Link>
          </Button>
        }
      />
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5">
          {pending.length > 0 && (
            <section aria-labelledby="dbaccess-pending" className="grid gap-3">
              <h2 id="dbaccess-pending" className="text-lg font-semibold">
                {t('pending', { count: pending.length })}
              </h2>
              <ul className="divide-y rounded-xl border bg-card">
                {pending.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={requestHref(r.reference)}
                      className="flex min-w-0 flex-col gap-1 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.reference}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {l(r.role.name)} · {r.server.displayName}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <RequestStatusBadge status={r.status} />
                        <span className="text-xs text-muted-foreground">
                          <RelativeTime date={r.createdAt} />
                        </span>
                        <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="dbaccess-live" className="grid gap-3">
            <h2 id="dbaccess-live" className="text-lg font-semibold">
              {t('access', { count: live.length })}
            </h2>
            {live.length === 0 ? (
              <div className="rounded-xl border bg-card">
                <EmptyState
                  icon={<DatabaseIcon />}
                  title={t('empty')}
                  description={t('emptyHint')}
                  action={
                    <Button asChild variant="outline">
                      <Link href="/dbaccess/request">
                        <PlusIcon /> {t('request')}
                      </Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {live.map((g) => (
                  <StaggerItem key={g.id} className="min-w-0">
                    <GrantCard grant={g} />
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </section>

          {data.ownedRoles > 0 && <OwnedAccess />}

          {(ended.length > 0 || decided.length > 0) && (
            <section aria-labelledby="dbaccess-history" className="grid gap-3">
              <h2 id="dbaccess-history" className="flex items-center gap-2 text-lg font-semibold">
                <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
                {t('history')}
              </h2>
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {ended.map((g) => (
                  <li
                    key={g.id}
                    className="flex min-w-0 flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {l(g.role.name)} · {g.server.displayName}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <GrantStatusBadge status={g.viewStatus} />
                      {g.endReason && <Badge variant="outline">{te(g.endReason)}</Badge>}
                      <span className="text-xs text-muted-foreground">
                        <RelativeTime date={g.endedAt} />
                      </span>
                    </span>
                  </li>
                ))}
                {decided.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={requestHref(r.reference)}
                      className="flex min-w-0 flex-col gap-1 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.reference}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {l(r.role.name)} · {r.server.displayName}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <RequestStatusBadge status={r.status} />
                        <span className="text-xs text-muted-foreground">
                          {r.decidedAt ? day(r.decidedAt) : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
