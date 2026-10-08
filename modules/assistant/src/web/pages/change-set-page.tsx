'use client';

import type { WorkflowInstanceSummary } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  BanIcon,
  BotIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileQuestionIcon,
  HourglassIcon,
  InboxIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  RocketIcon,
  SendIcon,
  ShieldAlertIcon,
  Undo2Icon,
  UndoDotIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { type ChangeSetItem, packageFileName } from '../../contracts';
import { CHECK, StatusBadge, ToneText } from '../badges';
import {
  ApplyDialog,
  EditDialog,
  RemoveItemDialog,
  RollbackDialog,
  SimpleActionDialog,
  SubmitDialog,
  useActionErrorText,
  useChangeSetAction,
} from '../change-set/dialogs';
import { ItemCard } from '../change-set/item-card';
import { LiveLinks, liveLinksOf } from '../change-set/live-links';
import {
  type AssistantStatusDto,
  type ChangeSetDetailDto,
  changeSetApiPath,
  checkCounts,
  exportHref,
  isOpenStatus,
  STATUS_PATH,
  useKindLabel,
} from '../lib';

type DialogName = 'apply' | 'submit' | 'withdraw' | 'rollback' | 'discard' | 'edit' | null;

/** Why the last apply, review or rollback didn't go through, in words (by code), with the server's detail. */
function LastErrorBanner({ error }: { error: NonNullable<ChangeSetDetailDto['lastError']> }) {
  const t = useTranslations('assistant.lastError');
  const te = useTranslations('errors');
  const d = (error.details ?? {}) as {
    reason?: string;
    label?: string;
    permissions?: string[];
    items?: { label?: string }[];
    issues?: { path?: string; message: string }[];
  };
  let text: string;
  if (error.code === 'INVALID_STATE' && d.reason === 'rejected')
    text =
      error.message && error.message !== 'Rejected'
        ? t('rejected', { comment: error.message })
        : t('rejectedPlain');
  else if (error.code === 'INVALID_STATE' && d.reason === 'no_approver') text = t('noApprover');
  else if (error.code === 'CHANGE_SET_STALE')
    text = d.items?.length
      ? t('stale', { items: d.items.map((i) => `“${i.label ?? ''}”`).join(', ') })
      : d.label
        ? t('stale', { items: `“${d.label}”` })
        : t('staleGeneric');
  else if (error.code === 'FORBIDDEN' && d.permissions?.length)
    text = t('forbidden', { permissions: d.permissions.join(', ') });
  else if (error.code === 'PRIVILEGE_ESCALATION') text = t('privilege');
  else if (error.code === 'VALIDATION_FAILED')
    text = d.label ? t('validationItem', { label: d.label }) : t('validation');
  else if (error.code === 'NOT_SUPPORTED') text = t('notReversible');
  else text = te.has(error.code) ? te(error.code) : t('generic');
  const showMessage =
    !!error.message &&
    !(error.code === 'INVALID_STATE' && d.reason === 'rejected') &&
    d.reason !== 'no_approver';

  return (
    <FadeIn
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm"
    >
      <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-destructive">{t('title')}</p>
        <p>{text}</p>
        {d.label && error.code !== 'VALIDATION_FAILED' && error.code !== 'CHANGE_SET_STALE' && (
          <p>{t('item', { label: d.label })}</p>
        )}
        {showMessage && <p className="text-xs break-words text-foreground">{error.message}</p>}
        {d.issues && d.issues.length > 0 && (
          <ul className="list-inside list-disc text-xs">
            {d.issues.slice(0, 10).map((i, n) => (
              <li key={n} className="break-words">
                {i.path && <code className="mr-1 font-mono">{i.path}</code>}
                {i.message}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-foreground">
          <span className="font-mono">{error.code}</span> · <DateTime date={error.at} />
        </p>
      </div>
    </FadeIn>
  );
}

/** The review in progress: who it waits for, the note, and the way to the approvals inbox. */
function ReviewCard({ detail }: { detail: ChangeSetDetailDto }) {
  const t = useTranslations('assistant.review');
  const locale = useLocale();
  const review = detail.review!;
  const instance = useApiQuery<WorkflowInstanceSummary & { myTaskId?: string | null }>(
    `/workflow-instances/${review.instanceId}`,
  );
  const wf = instance.data && !instance.error ? instance.data : null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HourglassIcon className="size-4 text-info" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {review.requestedAt && (
          <p className="text-muted-foreground">
            {t('requested')} <RelativeTime date={review.requestedAt} className="text-foreground" />
          </p>
        )}
        {review.note && (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t('note')}</p>
            <p className="rounded-lg bg-muted/50 px-3 py-2 whitespace-pre-wrap break-words">{review.note}</p>
          </div>
        )}
        {wf && wf.currentSteps.length > 0 && (
          <p>{t('atStep', { step: wf.currentSteps.map((s) => localize(s.name, locale)).join(', ') })}</p>
        )}
        {wf && wf.pendingWith.length > 0 && (
          <p>{t('pendingWith', { names: wf.pendingWith.map((p) => p.displayName).join(', ') })}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('approveApplies')}</p>
        {wf?.myTaskId ? (
          <Button asChild size="sm" className="justify-self-start">
            <Link href="/approvals">
              <InboxIcon /> {t('yourTurn')}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** A change set: its items with dry runs, diffs and previews, and the actions the viewer may take. */
export default function ChangeSetPage({ params }: WebPageProps) {
  const t = useTranslations('assistant.detail');
  const ta = useTranslations('assistant');
  const id = params.id ?? '';
  const headingId = useId();
  const { user } = usePlatform();
  const query = useApiQuery<ChangeSetDetailDto>(changeSetApiPath(id));
  const status = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const kindLabel = useKindLabel(status.data?.kinds);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [removing, setRemoving] = useState<ChangeSetItem | null>(null);
  const errorOf = useActionErrorText();
  const detail = query.data && query.data.id === id ? query.data : null;
  const refetch = () => void query.refetch();

  const check = useChangeSetAction(id, 'check', { success: t('checked') });
  const refresh = useChangeSetAction(id, 'refresh', { success: t('refreshed') });

  if (query.isLoading && !detail)
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  if (!detail) return <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} />;

  const p = detail.permissions;
  const open = isOpenStatus(detail.status);
  const counts = checkCounts(detail.items);
  const kindsById = new Map((status.data?.kinds ?? []).map((k) => [k.kind, k]));
  const isMine = detail.createdBy.type === 'user' && detail.createdBy.id === user.id;
  const actionError = check.error ?? refresh.error;
  // Export works in every status (a package file for another environment), once there is something to export.
  const canExport = detail.items.length > 0;
  const more = p.canDiscard || p.canWithdraw || canExport;
  // Where people use what it made (a form's own page), once applied.
  const live = liveLinksOf(detail.status, detail.items);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 justify-self-start text-muted-foreground">
        <Link href="/assistant/change-sets">
          <ArrowLeftIcon /> {t('back')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{detail.reference}</span>
            <StatusBadge status={detail.status} />
            {detail.createdBy.type === 'service' && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <BotIcon className="size-3.5" aria-hidden /> {t('fromApiClient')}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-start gap-1">
            <h1 id={headingId} className="min-w-0 text-2xl font-semibold tracking-tight break-words">
              <span className="sr-only">{detail.reference} </span>
              {detail.title || t('untitled')}
            </h1>
            {p.canEdit && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="mt-0.5 shrink-0 text-muted-foreground"
                onClick={() => setDialog('edit')}
                aria-label={t('edit')}
              >
                <PencilIcon />
              </Button>
            )}
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>
              {isMine ? t('createdByYou') : t('createdBy', { name: detail.createdBy.name })} ·{' '}
              <RelativeTime date={detail.createdAt} />
            </span>
            {detail.appliedBy && detail.appliedAt && (
              <span>
                {t('appliedBy', { name: detail.appliedBy.name })} · <DateTime date={detail.appliedAt} />
              </span>
            )}
            {detail.rolledBackBy && detail.rolledBackAt && (
              <span>
                {t('rolledBackBy', { name: detail.rolledBackBy.name })} ·{' '}
                <DateTime date={detail.rolledBackAt} />
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {open && detail.items.length > 0 && (
            <Button variant="outline" onClick={() => check.mutate()} loading={check.isPending}>
              {!check.isPending && <ListChecksIcon />}
              {t('actions.check')}
            </Button>
          )}
          {p.canRollback && (
            <Button variant="outline" onClick={() => setDialog('rollback')}>
              <Undo2Icon /> {t('actions.rollback')}
            </Button>
          )}
          {p.canSubmit && (
            <Button variant={p.canApply ? 'outline' : 'default'} onClick={() => setDialog('submit')}>
              <SendIcon /> {t('actions.submit')}
            </Button>
          )}
          {p.canApply && (
            <Button onClick={() => setDialog('apply')}>
              <RocketIcon /> {t('actions.apply')}
            </Button>
          )}
          {more && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('actions.more')}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canExport && (
                  <DropdownMenuItem asChild>
                    <a href={exportHref(detail.id)} download={packageFileName(detail.reference)}>
                      <DownloadIcon /> {t('actions.export')}
                    </a>
                  </DropdownMenuItem>
                )}
                {p.canWithdraw && (
                  <DropdownMenuItem onSelect={() => setDialog('withdraw')}>
                    <UndoDotIcon /> {t('actions.withdraw')}
                  </DropdownMenuItem>
                )}
                {p.canDiscard && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog('discard')}>
                    <BanIcon /> {t('actions.discard')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </FadeIn>

      {actionError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errorOf(actionError)}
        </p>
      )}
      {detail.lastError && <LastErrorBanner error={detail.lastError} />}
      {live.length > 0 && (
        <section
          aria-labelledby={`${headingId}-live`}
          className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/8 px-4 py-3 text-sm"
        >
          <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <h2 id={`${headingId}-live`} className="font-semibold text-success">
              {t('live.title')}
            </h2>
            <p>{t('live.body')}</p>
            <LiveLinks links={live} />
          </div>
        </section>
      )}

      {open && !p.canApply && p.missing.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/8 px-4 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-info">{t('missing.title')}</p>
            <p>
              {t(detail.status === 'in_review' ? 'missing.bodyInReview' : 'missing.body', {
                permissions: p.missing.join(', '),
              })}
            </p>
          </div>
        </div>
      )}
      {detail.status === 'applied' && p.rollbackBlocked && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t(
            p.rollbackBlocked === 'not_reversible'
              ? 'rollbackBlocked.notReversible'
              : 'rollbackBlocked.other',
          )}
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby={`${headingId}-items`} className="grid min-w-0 gap-4">
          <h2 id={`${headingId}-items`} className="text-lg font-semibold">
            {t('itemsTitle')}
          </h2>
          {detail.items.length === 0 ? (
            <div className="rounded-xl border border-dashed">
              <EmptyState
                icon={<ListChecksIcon />}
                title={t('itemsEmpty')}
                description={t('itemsEmptyHint')}
              />
            </div>
          ) : (
            <ol className="grid min-w-0 gap-4">
              {detail.items.map((item, index) => (
                <li key={item.id} className="min-w-0">
                  <ItemCard
                    item={item}
                    detail={detail}
                    kind={kindsById.get(item.kind)}
                    kindLabel={kindLabel(item.kind)}
                    onRemove={setRemoving}
                    onRefresh={() => refresh.mutate()}
                    refreshing={refresh.isPending}
                    first={index === 0}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="grid min-w-0 gap-4 lg:sticky lg:top-20">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-base">{t('summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {detail.summary ? (
                <p className="text-sm whitespace-pre-wrap break-words">{detail.summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noSummary')}</p>
              )}
              <dl className="divide-y">
                <Fact label={t('stats.items')}>{ta('card.items', { count: detail.itemCount })}</Fact>
                <Fact label={t('stats.kinds')}>
                  {detail.kinds.length ? detail.kinds.map((k) => kindLabel(k)).join(', ') : '—'}
                </Fact>
                {open && (
                  <Fact label={t('stats.result')}>
                    <span className="flex flex-col gap-1" role="status">
                      {detail.items.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : counts.failing + counts.needsApprover + counts.unchecked === 0 ? (
                        <ToneText meta={CHECK.ok} label={ta('card.ready')} />
                      ) : (
                        <>
                          {counts.failing > 0 && (
                            <ToneText
                              meta={CHECK.failing}
                              label={ta('card.failing', { count: counts.failing })}
                            />
                          )}
                          {counts.needsApprover > 0 && (
                            <ToneText
                              meta={CHECK.needsApprover}
                              label={ta('card.needsApprover', { count: counts.needsApprover })}
                            />
                          )}
                          {counts.unchecked > 0 && (
                            <ToneText meta={CHECK.unchecked} label={ta('card.unchecked')} />
                          )}
                        </>
                      )}
                    </span>
                  </Fact>
                )}
                {open && (
                  <Fact label={t('stats.checked')}>
                    <RelativeTime date={detail.checkedAt} />
                  </Fact>
                )}
                <Fact label={t('stats.updated')}>
                  <RelativeTime date={detail.updatedAt} />
                </Fact>
              </dl>
              {detail.destructive && open && (
                <p className="flex items-start gap-2 text-xs text-destructive">
                  <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t('destructiveNote')}
                </p>
              )}
              {open && detail.items.some((i) => i.stale) && p.canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refresh.mutate()}
                  loading={refresh.isPending}
                  className="justify-self-start"
                >
                  {!refresh.isPending && <RefreshCwIcon />} {t('actions.refresh')}
                </Button>
              )}
            </CardContent>
          </Card>
          {detail.status === 'in_review' && detail.review && <ReviewCard detail={detail} />}
        </aside>
      </div>

      <ApplyDialog
        detail={detail}
        open={dialog === 'apply'}
        onOpenChange={(o) => setDialog(o ? 'apply' : null)}
        onFailed={refetch}
      />
      <SubmitDialog
        detail={detail}
        open={dialog === 'submit'}
        onOpenChange={(o) => setDialog(o ? 'submit' : null)}
      />
      <RollbackDialog
        detail={detail}
        open={dialog === 'rollback'}
        onOpenChange={(o) => setDialog(o ? 'rollback' : null)}
        onFailed={refetch}
      />
      <SimpleActionDialog
        detail={detail}
        action="withdraw"
        open={dialog === 'withdraw'}
        onOpenChange={(o) => setDialog(o ? 'withdraw' : null)}
      />
      <SimpleActionDialog
        detail={detail}
        action="discard"
        destructive
        open={dialog === 'discard'}
        onOpenChange={(o) => setDialog(o ? 'discard' : null)}
      />
      {p.canEdit && (
        <EditDialog
          detail={detail}
          open={dialog === 'edit'}
          onOpenChange={(o) => setDialog(o ? 'edit' : null)}
        />
      )}
      <RemoveItemDialog detail={detail} item={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
