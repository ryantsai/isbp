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
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { AnimatedItem, AnimatedList, Disclosure } from '@isbp/ui/motion';
import { DetailHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ClipboardCheckIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PencilIcon,
  ShieldAlertIcon,
  UserMinusIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { AccountEvent, SharedAccount } from '../../contracts';
import {
  AccountFormSheet,
  AddPersonDialog,
  PasswordChangedDialog,
  ReviewAccountDialog,
} from '../account-dialogs';
import { PasswordDueBadge, SharedAccountStatusBadge } from '../badges';
import { INVALIDATE, useDay } from '../lib';
import { LinksAndFiles } from '../record-panels';

const TABS = ['overview', 'history', 'links'] as const;
type Tab = (typeof TABS)[number];

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
  const [state, set] = useListState();
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const [adding, setAdding] = useState(false);
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

  const details: [string, ReactNode][] = [
    [t('fields.targetSystem'), a.targetSystem],
    [t('fields.targetRecord'), a.targetRef ? <RecordValues refs={[a.targetRef]} /> : null],
    [t('fields.department'), a.department?.name],
    [t('fields.purpose'), a.purpose],
    [t('fields.project'), a.project],
    [t('fields.requestReference'), a.requestReference],
    [t('fields.notes'), a.notes],
  ];
  const filled = details.filter(([, v]) => v !== null && v !== undefined && v !== '');
  const empty = details.filter(([, v]) => v === null || v === undefined || v === '');

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: '/isms/accounts', label: t('accounts.title'), highlight: a.id }}
        icon={<KeyRoundIcon />}
        reference={[a.reference, a.targetSystem].filter(Boolean).join(' · ')}
        title={<span className="font-mono">{a.accountName}</span>}
        status={
          a.status === 'active' && pc.due ? (
            <PasswordDueBadge animate />
          ) : (
            <SharedAccountStatusBadge status={a.status} animate />
          )
        }
        meta={a.custodian ? t('account.custodianIs', { name: a.custodian.displayName }) : undefined}
        primaryAction={
          tend && (pc.due || !a.reviewDue) ? (
            <Button variant={pc.due ? 'default' : 'outline'} onClick={() => setDialog('password')}>
              <KeyRoundIcon /> {t('account.passwordChanged')}
            </Button>
          ) : tend ? (
            <Button onClick={() => setDialog('review')}>
              <ClipboardCheckIcon /> {t('account.review')}
            </Button>
          ) : undefined
        }
        actions={[
          ...(tend && (pc.due || !a.reviewDue)
            ? [
                {
                  id: 'review',
                  label: t('account.review'),
                  icon: <ClipboardCheckIcon />,
                  onSelect: () => setDialog('review'),
                },
              ]
            : tend
              ? [
                  {
                    id: 'password',
                    label: t('account.passwordChanged'),
                    icon: <KeyRoundIcon />,
                    onSelect: () => setDialog('password'),
                  },
                ]
              : []),
          ...(a.viewer.canManage
            ? [{ id: 'edit', label: tc('edit'), icon: <PencilIcon />, onSelect: () => setDialog('edit') }]
            : []),
        ]}
      />

      {/* Removed from the DOM once it has faded out; while it fades it keeps the text it had. */}
      <AnimatedList as="div">
        {a.status === 'active' && pc.due && (
          <AnimatedItem as="div" key="due">
            <div
              role="status"
              className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-start"
            >
              <ShieldAlertIcon aria-hidden className="size-5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1 space-y-1">
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
              {tend && (
                <Button size="sm" className="self-start" onClick={() => setDialog('password')}>
                  <KeyRoundIcon /> {t('account.passwordChanged')}
                </Button>
              )}
            </div>
          </AnimatedItem>
        )}
      </AnimatedList>
      {a.status === 'active' && a.reviewDue && (
        <p role="status" className="rounded-lg border bg-warning/10 p-3 text-sm text-warning-foreground">
          {t('account.reviewDue', { date: day(a.nextReviewOn) })}
        </p>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => set({ tab: v === 'overview' ? undefined : v })}
        className="gap-4"
      >
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
                  <Field label={t('fields.lastPasswordChangeOn')}>
                    {a.lastPasswordChangeOn ? day(a.lastPasswordChangeOn) : null}
                  </Field>
                  <Field label={t('fields.nextReviewOn')}>
                    {a.nextReviewOn ? day(a.nextReviewOn) : null}
                  </Field>
                  {a.lastReviewedOn && (
                    <Field label={t('fields.lastReviewedOn')}>
                      {`${day(a.lastReviewedOn)}${a.lastReviewedBy ? ` · ${a.lastReviewedBy.displayName}` : ''}`}
                    </Field>
                  )}
                  {filled.map(([label, value]) => (
                    <Field key={label} label={label}>
                      {value}
                    </Field>
                  ))}
                  <Field label={tc('created_at')}>
                    <DateTime date={a.createdAt} />
                  </Field>
                </dl>
                {empty.length > 0 && (
                  <Disclosure
                    summary={t('account.emptyDetails', { count: empty.length })}
                    className="mt-2"
                    triggerClassName="text-sm text-muted-foreground"
                  >
                    <dl>
                      {empty.map(([label]) => (
                        <Field key={label} label={label}>
                          {null}
                        </Field>
                      ))}
                    </dl>
                  </Disclosure>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t('fields.members')}</CardTitle>
                <CardDescription>
                  {t('account.membersDescription', { count: a.members.length })}
                </CardDescription>
                {a.viewer.canManage && a.status === 'active' && (
                  <CardAction>
                    <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                      <UserPlusIcon /> {t('account.addPerson')}
                    </Button>
                  </CardAction>
                )}
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

      {a.viewer.canManage && adding && <AddPersonDialog account={a} onOpenChange={(o) => setAdding(o)} />}
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
