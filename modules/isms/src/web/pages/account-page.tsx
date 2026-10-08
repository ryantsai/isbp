'use client';

import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  ClipboardCheckIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PencilIcon,
  ShieldAlertIcon,
  UserMinusIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { AccountEvent, SharedAccount } from '../../contracts';
import { AccountFormSheet, PasswordChangedDialog, ReviewAccountDialog } from '../account-dialogs';
import { PasswordDueBadge, SharedAccountStatusBadge } from '../badges';
import { INVALIDATE, useDay } from '../lib';
import { LinksAndFiles } from '../record-panels';

type Tab = 'overview' | 'history' | 'links';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function AccountHistory({ reference }: { reference: string }) {
  const t = useTranslations('isms');
  const day = useDay();
  const { data, isLoading } = useApiQuery<Page<AccountEvent>>(`/isms/accounts/${reference}/events`, {
    pageSize: 50,
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data?.items.length) return <p className="text-sm text-muted-foreground">{t('history.none')}</p>;
  return (
    <ol className="space-y-3">
      {data.items.map((e) => (
        <li key={e.id} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">
              {t(`accountHistory.${e.kind as 'created'}`, {
                user: e.user?.displayName ?? '',
                date: day(
                  (e.data?.changedOn as string | undefined) ??
                    (e.data?.nextReviewOn as string | undefined) ??
                    null,
                ),
                reason: (e.data?.reason as string | undefined) ?? 'member_removed',
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {e.actor?.displayName ?? t('history.system')} · <RelativeTime date={e.createdAt} />
            </span>
          </div>
          {e.note && <p className="mt-1 text-muted-foreground">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** One shared account: custodian, members, password status, yearly review, history and links. */
export default function AccountPage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const api = useApi();
  const day = useDay();
  const {
    data: a,
    isLoading,
    error,
  } = useApiQuery<SharedAccount>(`/isms/accounts/${encodeURIComponent(params.ref ?? '')}`);
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<'edit' | 'password' | 'review' | null>(null);
  const [removing, setRemoving] = useState<{ id: string; displayName: string } | null>(null);
  const remove = useApiMutation(
    (_api, userId: string) => api.delete<SharedAccount>(`/isms/accounts/${a!.reference}/members/${userId}`),
    { invalidate: INVALIDATE, success: t('account.memberRemoved'), onSuccess: () => setRemoving(null) },
  );

  if (isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error || !a) return <EmptyState icon={<FileQuestionIcon />} title={t('account.notFound')} />;
  const tend = a.viewer.canRecordPassword;
  const pc = a.passwordChange;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/isms/accounts">
          <ArrowLeftIcon /> {t('accounts.title')}
        </Link>
      </Button>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <KeyRoundIcon aria-hidden className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{a.reference}</span>
              {a.targetSystem && <> · {a.targetSystem}</>}
            </p>
            <h1 className="font-mono text-2xl font-semibold tracking-tight wrap-anywhere">{a.accountName}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {a.status === 'active' && pc.due ? (
                <PasswordDueBadge />
              ) : (
                <SharedAccountStatusBadge status={a.status} />
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {tend && (
            <Button variant={pc.due ? 'default' : 'outline'} onClick={() => setDialog('password')}>
              <KeyRoundIcon /> {t('account.passwordChanged')}
            </Button>
          )}
          {tend && (
            <Button variant="outline" onClick={() => setDialog('review')}>
              <ClipboardCheckIcon /> {t('account.review')}
            </Button>
          )}
          {a.viewer.canManage && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {tc('edit')}
            </Button>
          )}
        </div>
      </div>

      {a.status === 'active' && pc.due && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <ShieldAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium text-destructive">{t('account.dueTitle')}</p>
            <p>
              {t('account.dueBody', {
                reason: pc.reason ?? 'member_removed',
                member: pc.member?.displayName ?? '',
              })}
              {pc.since && (
                <>
                  {' '}
                  (<RelativeTime date={pc.since} />)
                </>
              )}
            </p>
          </div>
        </div>
      )}
      {a.status === 'active' && a.reviewDue && (
        <p role="status" className="rounded-lg border bg-warning/10 p-3 text-sm text-warning-foreground">
          {t('account.reviewDue', { date: day(a.nextReviewOn) })}
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{tc('overview')}</TabsTrigger>
          <TabsTrigger value="history">{t('history.title')}</TabsTrigger>
          <TabsTrigger value="links">{t('links.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="min-w-0">
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('account.about')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  <Field label={t('fields.custodian')}>{a.custodian?.displayName}</Field>
                  <Field label={t('fields.targetSystem')}>{a.targetSystem}</Field>
                  <Field label={t('fields.targetRecord')}>
                    {a.targetRef ? <RecordValues refs={[a.targetRef]} /> : null}
                  </Field>
                  <Field label={t('fields.department')}>{a.department?.name}</Field>
                  <Field label={t('fields.purpose')}>{a.purpose}</Field>
                  <Field label={t('fields.project')}>{a.project}</Field>
                  <Field label={t('fields.requestReference')}>{a.requestReference}</Field>
                  <Field label={t('fields.lastPasswordChangeOn')}>
                    {a.lastPasswordChangeOn ? day(a.lastPasswordChangeOn) : null}
                  </Field>
                  <Field label={t('fields.nextReviewOn')}>
                    {a.nextReviewOn ? day(a.nextReviewOn) : null}
                  </Field>
                  <Field label={t('fields.lastReviewedOn')}>
                    {a.lastReviewedOn
                      ? `${day(a.lastReviewedOn)}${a.lastReviewedBy ? ` · ${a.lastReviewedBy.displayName}` : ''}`
                      : null}
                  </Field>
                  <Field label={tc('created_at')}>
                    <DateTime date={a.createdAt} />
                  </Field>
                  {a.notes && <Field label={t('fields.notes')}>{a.notes}</Field>}
                </dl>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('fields.members')}</CardTitle>
                <CardDescription>
                  {t('account.membersDescription', { count: a.members.length })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!a.members.length ? (
                  <p className="text-sm text-muted-foreground">{t('account.noMembers')}</p>
                ) : (
                  <ul className="divide-y">
                    {a.members.map((m) => (
                      <li key={m.user.id} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {m.user.displayName}
                          {!m.active && (
                            <span className="text-muted-foreground"> · {t('account.inactive')}</span>
                          )}
                        </span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          {t('account.since', { date: day(m.addedAt.slice(0, 10)) })}
                        </span>
                        {tend && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('account.removeMember', { name: m.user.displayName })}
                            onClick={() => setRemoving(m.user)}
                          >
                            <UserMinusIcon />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="history" className="min-w-0">
          {tab === 'history' && <AccountHistory reference={a.reference} />}
        </TabsContent>
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="isms.account" id={a.id} />}
        </TabsContent>
      </Tabs>

      {a.viewer.canManage && (
        <AccountFormSheet
          open={dialog === 'edit'}
          onOpenChange={(o) => setDialog(o ? 'edit' : null)}
          account={a}
        />
      )}
      {tend && (
        <>
          <PasswordChangedDialog
            account={a}
            open={dialog === 'password'}
            onOpenChange={(o) => setDialog(o ? 'password' : null)}
          />
          {dialog === 'review' && (
            <ReviewAccountDialog account={a} open onOpenChange={(o) => setDialog(o ? 'review' : null)} />
          )}
        </>
      )}
      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('account.removeTitle', { name: removing?.displayName ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('account.removeDescription', { account: a.accountName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removing) remove.mutate(removing.id);
              }}
            >
              {tc('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
