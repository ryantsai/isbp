'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList, Disclosure } from '@isbp/ui/motion';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ClipboardCheckIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
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

/** A value in a facts list; "—" when there is none. */
const show = (value: ReactNode) => (value === null || value === undefined || value === '' ? '—' : value);

function AccountHistory({ reference }: { reference: string }) {
  const t = useTranslations('isms');
  const day = useDay();
  const { data, isLoading } = useApiQuery<Page<AccountEvent>>(`/isms/accounts/${reference}/events`, {
    pageSize: 50,
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data?.items.length)
    return (
      <Text as="p" color="secondary">
        {t('history.none')}
      </Text>
    );
  return (
    <List hasDividers>
      {data.items.map((e) => (
        <ListItem
          key={e.id}
          label={t(`accountHistory.${e.kind as 'created'}`, {
            user: e.user?.displayName ?? '',
            date: day(
              (e.data?.changedOn as string | undefined) ??
                (e.data?.nextReviewOn as string | undefined) ??
                null,
            ),
            reason: (e.data?.reason as string | undefined) ?? 'member_removed',
          })}
          description={e.note ?? undefined}
          endContent={
            <Text type="supporting">
              {e.actor?.displayName ?? t('history.system')} · <RelativeTime date={e.createdAt} />
            </Text>
          }
        />
      ))}
    </List>
  );
}

/** One shared account: custodian, members, password status, yearly review, history and links. */
export default function AccountPage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const api = useApi();
  const day = useDay();
  const panels = useId();
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
    <div className="space-y-5">
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
            <Button
              label={t('account.passwordChanged')}
              variant={pc.due ? 'primary' : 'secondary'}
              icon={<Icon icon={KeyRoundIcon} />}
              onClick={() => setDialog('password')}
            />
          ) : tend ? (
            <Button
              label={t('account.review')}
              variant="primary"
              icon={<Icon icon={ClipboardCheckIcon} />}
              onClick={() => setDialog('review')}
            />
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
            <Banner
              status="error"
              title={t('account.dueTitle')}
              description={
                <>
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
                </>
              }
              collapsible={false}
              endContent={
                tend ? (
                  <Button
                    label={t('account.passwordChanged')}
                    variant="primary"
                    size="sm"
                    icon={<Icon icon={KeyRoundIcon} />}
                    onClick={() => setDialog('password')}
                  />
                ) : undefined
              }
            />
          </AnimatedItem>
        )}
      </AnimatedList>
      {a.status === 'active' && a.reviewDue && (
        <Banner
          status="warning"
          title={t('account.reviewDue', { date: day(a.nextReviewOn) })}
          collapsible={false}
        />
      )}

      <VStack gap={4}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) => set({ tab: v === 'overview' ? undefined : v })}
          hasDivider
        >
          <Tab value="overview" label={tc('overview')} panelId={`${panels}-overview`} />
          <Tab value="history" label={t('history.title')} panelId={`${panels}-history`} />
          <Tab value="links" label={t('links.title')} panelId={`${panels}-links`} />
        </TabList>
        <div role="tabpanel" id={`${panels}-overview`} hidden={tab !== 'overview'} className="min-w-0">
          {tab === 'overview' && (
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>{t('account.about')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <VStack gap={2}>
                    <MetadataList>
                      <MetadataListItem label={t('fields.custodian')}>
                        {show(a.custodian?.displayName)}
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.lastPasswordChangeOn')}>
                        {show(a.lastPasswordChangeOn ? day(a.lastPasswordChangeOn) : null)}
                      </MetadataListItem>
                      <MetadataListItem label={t('fields.nextReviewOn')}>
                        {show(a.nextReviewOn ? day(a.nextReviewOn) : null)}
                      </MetadataListItem>
                      {a.lastReviewedOn && (
                        <MetadataListItem label={t('fields.lastReviewedOn')}>
                          {`${day(a.lastReviewedOn)}${a.lastReviewedBy ? ` · ${a.lastReviewedBy.displayName}` : ''}`}
                        </MetadataListItem>
                      )}
                      {filled.map(([label, value]) => (
                        <MetadataListItem key={label} label={label}>
                          {value}
                        </MetadataListItem>
                      ))}
                      <MetadataListItem label={tc('created_at')}>
                        <DateTime date={a.createdAt} />
                      </MetadataListItem>
                    </MetadataList>
                    {empty.length > 0 && (
                      <Disclosure
                        summary={t('account.emptyDetails', { count: empty.length })}
                        className="mt-2"
                        triggerClassName="text-sm text-muted-foreground"
                      >
                        <MetadataList>
                          {empty.map(([label]) => (
                            <MetadataListItem key={label} label={label}>
                              —
                            </MetadataListItem>
                          ))}
                        </MetadataList>
                      </Disclosure>
                    )}
                  </VStack>
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
                      <Button
                        label={t('account.addPerson')}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={UserPlusIcon} />}
                        onClick={() => setAdding(true)}
                      />
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  {!a.members.length ? (
                    <Text as="p" color="secondary">
                      {t('account.noMembers')}
                    </Text>
                  ) : (
                    <List hasDividers>
                      {a.members.map((m) => (
                        <ListItem
                          key={m.user.id}
                          label={m.user.displayName}
                          description={m.active ? undefined : t('account.inactive')}
                          endContent={
                            <HStack gap={2} vAlign="center">
                              <Text type="supporting">
                                {t('account.since', { date: day(m.addedAt.slice(0, 10)) })}
                              </Text>
                              {tend && (
                                <IconButton
                                  label={t('account.removeMember', { name: m.user.displayName })}
                                  variant="ghost"
                                  size="sm"
                                  icon={<Icon icon={UserMinusIcon} />}
                                  onClick={() => setRemoving(m.user)}
                                />
                              )}
                            </HStack>
                          }
                        />
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
        <div role="tabpanel" id={`${panels}-history`} hidden={tab !== 'history'} className="min-w-0">
          {tab === 'history' && <AccountHistory reference={a.reference} />}
        </div>
        <div role="tabpanel" id={`${panels}-links`} hidden={tab !== 'links'} className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="isms.account" id={a.id} />}
        </div>
      </VStack>

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
      <AlertDialog
        isOpen={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('account.removeTitle', { name: removing?.displayName ?? '' })}
        description={t('account.removeDescription', { account: a.accountName })}
        cancelLabel={tc('cancel')}
        actionLabel={tc('remove')}
        actionVariant="primary"
        isActionLoading={remove.isPending}
        onAction={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}
