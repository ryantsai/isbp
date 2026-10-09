'use client';

import type { Group, WorkflowInstanceSummary } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { duration, ease, FadeIn, useReducedMotion } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BanIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  DownloadIcon,
  FileQuestionIcon,
  HourglassIcon,
  InboxIcon,
  ListChecksIcon,
  ListTreeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  RocketIcon,
  SendIcon,
  ShieldAlertIcon,
  Undo2Icon,
  UndoDotIcon,
  UsersIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { type ChangeSetItem, packageFileName } from '../../contracts';
import {
  countByKind,
  groupByProcess,
  type ItemGroup,
  type PlanItem,
  PROCESS_KIND,
} from '../../lib/processes';
import { CHECK, StatusBadge, ToneText } from '../badges';
import { useDescribe, useDescribeNames } from '../change-set/describe';
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
import { flipDelayOf, ItemCard } from '../change-set/item-card';
import { LiveLinks, liveLinksOf } from '../change-set/live-links';
import { PermissionNamesProvider, usePermissionList } from '../change-set/permission-names';
import { KindCounts } from '../kind-counts';
import {
  type AssistantStatusDto,
  type ChangeSetDetailDto,
  changeSetApiPath,
  checkCounts,
  checkState,
  exportHref,
  isOpenStatus,
  STATUS_PATH,
  useKindLabel,
} from '../lib';

type DialogName = 'apply' | 'submit' | 'withdraw' | 'rollback' | 'discard' | 'edit' | null;

/** Cards and groups start collapsed above this many changes. */
const COLLAPSE_ABOVE = 5;
/** "Add rules or actions in the form builder" for up to this many new forms. */
const BUILDER_LINKS = 3;

/** Why the last apply, review or rollback didn't go through, in words (by code), with the server's detail. */
function LastErrorBanner({ error }: { error: NonNullable<ChangeSetDetailDto['lastError']> }) {
  const t = useTranslations('assistant.lastError');
  const te = useTranslations('errors');
  const permissionList = usePermissionList();
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
    text = t('forbidden', { permissions: permissionList(d.permissions) });
  else if (error.code === 'PRIVILEGE_ESCALATION') text = t('privilege');
  else if (error.code === 'VALIDATION_FAILED')
    text = d.label ? t('validationItem', { label: d.label }) : t('validation');
  else if (error.code === 'NOT_SUPPORTED') text = t('notReversible');
  else text = te.has(error.code) ? te(error.code) : t('generic');
  const showMessage =
    !!error.message &&
    !(error.code === 'INVALID_STATE' && d.reason === 'rejected') &&
    d.reason !== 'no_approver' &&
    error.code !== 'FORBIDDEN';

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
          <DateTime date={error.at} />
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
            <p className="rounded-lg bg-muted/50 px-3 py-2 break-words whitespace-pre-wrap">{review.note}</p>
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

/** "Ready to use": where people use what the change set made, sliding in when it is applied. */
function ReadyToUse({ detail, headingId }: { detail: ChangeSetDetailDto; headingId: string }) {
  const t = useTranslations('assistant.detail');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const live = liveLinksOf(detail.status, detail.items);
  // New forms can get rules and actions the guided templates and packs don't ask about.
  const forms = detail.items.filter(
    (i) => i.kind === PROCESS_KIND && i.op === 'create' && i.after?.href && !i.after.archived,
  );
  const builder = detail.status === 'applied' && forms.length <= BUILDER_LINKS ? forms : [];
  const shown = live.length > 0 || builder.length > 0;
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.section
          key="live"
          aria-labelledby={`${headingId}-live`}
          initial={reduce ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: ease.enter }}
          className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/8 px-4 py-3 text-sm"
        >
          <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <h2 id={`${headingId}-live`} className="font-semibold text-success">
              {t('live.title')}
            </h2>
            {live.length > 0 && (
              <>
                <p>{t('live.body')}</p>
                <LiveLinks links={live} />
              </>
            )}
            {builder.length > 0 && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {builder.map((f) => {
                  const name =
                    localize((f.after?.value as { name?: never } | undefined)?.name, locale) || f.label;
                  return (
                    <li key={f.id} className="min-w-0 break-words">
                      <Link
                        href={f.after!.href!}
                        aria-label={t('live.builderFor', { name })}
                        className="inline-flex items-center gap-0.5 rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {t('live.builder')}
                        <ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden />
                      </Link>
                      {builder.length > 1 && (
                        <span aria-hidden className="text-muted-foreground">
                          {' '}
                          · {name}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** A group the change set created, and whether it has members yet. */
function GroupToDo({ item }: { item: ChangeSetItem }) {
  const t = useTranslations('assistant.detail.next');
  const canRead = useCan('core.groups.read');
  const id = item.after?.id ?? item.appliedId;
  const { data } = useApiQuery<Group>(canRead && id ? `/groups/${id}` : null);
  const members = data?.memberCount;
  const done = typeof members === 'number' && members > 0;
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {item.after?.href ? (
        <Link
          href={item.after.href}
          className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {item.after.label || item.label}
        </Link>
      ) : (
        <span className="font-medium">{item.label}</span>
      )}
      {typeof members === 'number' &&
        (done ? (
          <ToneText meta={CHECK.ok} label={t('members', { count: members })} />
        ) : (
          <ToneText meta={{ icon: CircleDashedIcon, tone: 'warning' }} label={t('noMembers')} />
        ))}
    </li>
  );
}

/**
 * After applying: what is left for a person to do. Packages and templates never carry people, so the groups they
 * create are empty until someone adds members — the approvals and checklists that name them reach nobody until then.
 */
function NextSteps({ detail, headingId }: { detail: ChangeSetDetailDto; headingId: string }) {
  const t = useTranslations('assistant.detail.next');
  if (detail.status !== 'applied') return null;
  const groups = detail.items.filter(
    (i) => i.kind === 'core.group' && i.op === 'create' && i.after && !i.after.archived,
  );
  if (!groups.length) return null;
  return (
    <section
      aria-labelledby={`${headingId}-next`}
      className="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
    >
      <UsersIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 space-y-1.5">
        <h2 id={`${headingId}-next`} className="font-semibold">
          {t('title')}
        </h2>
        <p>{t('groups', { count: groups.length })}</p>
        <ul className="grid gap-1">
          {groups.map((g) => (
            <GroupToDo key={g.id} item={g} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Where a group's readiness stands: all ready, or how many can't be applied / need a reviewer. */
function GroupStatus({ items, status }: { items: readonly ChangeSetItem[]; status: string }) {
  const t = useTranslations('assistant.card');
  if (!isOpenStatus(status)) return null;
  const c = checkCounts(items);
  if (c.failing) return <ToneText meta={CHECK.failing} label={t('failing', { count: c.failing })} />;
  if (c.needsApprover)
    return <ToneText meta={CHECK.needsApprover} label={t('needsApprover', { count: c.needsApprover })} />;
  if (c.unchecked) return <ToneText meta={CHECK.unchecked} label={t('unchecked')} />;
  return <ToneText meta={CHECK.ok} label={t('ready')} />;
}

/** The DOM id of a group's section (outline links point at it). */
const groupDomId = (base: string, group: ItemGroup) => `${base}-${group.id.replace(/[^a-z0-9-]/gi, '-')}`;

/** A change set: its items grouped by process with what they do, and the actions the viewer may take. */
export default function ChangeSetPage({ params }: WebPageProps) {
  const id = params.id ?? '';
  const query = useApiQuery<ChangeSetDetailDto>(changeSetApiPath(id));
  const t = useTranslations('assistant.detail');
  const detail = query.data && query.data.id === id ? query.data : null;

  if (query.isLoading && !detail)
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  if (!detail) return <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} />;
  return (
    <PermissionNamesProvider roles={detail.permissionRoles}>
      <ChangeSetView detail={detail} refetch={() => void query.refetch()} />
    </PermissionNamesProvider>
  );
}

function ChangeSetView({ detail, refetch }: { detail: ChangeSetDetailDto; refetch: () => void }) {
  const t = useTranslations('assistant.detail');
  const ta = useTranslations('assistant');
  const headingId = useId();
  const { user } = usePlatform();
  const status = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const kindLabel = useKindLabel(status.data?.kinds);
  const permissionList = usePermissionList();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [removing, setRemoving] = useState<ChangeSetItem | null>(null);
  const errorOf = useActionErrorText();
  const check = useChangeSetAction(detail.id, 'check', { success: t('checked') });
  const refresh = useChangeSetAction(detail.id, 'refresh', { success: t('refreshed') });

  // "Applied" chips flip in a short stagger when the set is applied while the page is open.
  const [seenStatus, setSeenStatus] = useState(detail.status);
  const [flipping, setFlipping] = useState(false);
  if (detail.status !== seenStatus) {
    setSeenStatus(detail.status);
    setFlipping(detail.status === 'applied' && isOpenStatus(seenStatus));
  }

  const p = detail.permissions;
  const open = isOpenStatus(detail.status);
  const counts = checkCounts(detail.items);
  const kindsById = new Map((status.data?.kinds ?? []).map((k) => [k.kind, k]));
  const isMine = detail.createdBy.type === 'user' && detail.createdBy.id === user.id;
  const actionError = check.error ?? refresh.error;
  // Export works in every status (a package file for another environment), once there is something to export.
  const canExport = detail.items.length > 0;
  const more = p.canDiscard || p.canWithdraw || canExport;

  const items = useMemo(() => [...detail.items].sort((a, b) => a.position - b.position), [detail.items]);
  // Described and grouped by what was proposed: its "$ref"s keep a form and its workflow together once applied too.
  const plan: PlanItem[] = items;
  const grouping = useMemo(() => groupByProcess(plan), [plan]);
  const tally = useMemo(() => countByKind(plan, grouping), [plan, grouping]);
  const names = useDescribeNames(plan);
  const describe = useDescribe(plan, names);
  const numberOf = new Map(items.map((i, n) => [i.id, n + 1]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const planById = new Map(plan.map((i) => [i.id, i]));
  const grouped = tally.processes > 0;
  const collapsible = items.length > COLLAPSE_ABOVE;

  // Groups start open on short change sets, and when they hold a change that can't be applied.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const groupOpen = (g: ItemGroup) =>
    overrides[g.id] ??
    (!collapsible || g.itemIds.some((i) => checkState(byId.get(i)!) === 'failing' && open));
  const setAll = (value: boolean) =>
    setOverrides(Object.fromEntries(grouping.groups.map((g) => [g.id, value])));

  const groupTitle = (g: ItemGroup) =>
    g.type === 'process'
      ? byId.get(g.anchorId!)!.label
      : t(g.type === 'shared' ? 'groups.shared' : 'groups.other');

  const card = (item: ChangeSetItem, headingLevel: 3 | 4) => (
    <ItemCard
      key={item.id}
      item={item}
      number={numberOf.get(item.id)!}
      detail={detail}
      kind={kindsById.get(item.kind)}
      kindLabel={kindLabel(item.kind)}
      lines={describe(planById.get(item.id)!)}
      defaultOpen={!collapsible}
      canRemove
      onRemove={setRemoving}
      onRefresh={() => refresh.mutate()}
      refreshing={refresh.isPending}
      flipDelay={flipping ? flipDelayOf(numberOf.get(item.id)! - 1) : undefined}
      headingLevel={headingLevel}
    />
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 justify-self-start text-muted-foreground">
        <Link href="/assistant/change-sets">
          <ArrowLeftIcon /> {t('back')}
        </Link>
      </Button>

      <FadeIn className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
      <ReadyToUse detail={detail} headingId={headingId} />
      <NextSteps detail={detail} headingId={headingId} />

      {open && !p.canApply && p.missing.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/8 px-4 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-info">{t('missing.title')}</p>
            <p>
              {t(detail.status === 'in_review' ? 'missing.bodyInReview' : 'missing.body', {
                permissions: permissionList(p.missing),
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
        <aside className="grid min-w-0 gap-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-base">{t('summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {detail.summary ? (
                <p className="text-sm break-words whitespace-pre-wrap">{detail.summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noSummary')}</p>
              )}
              <dl className="divide-y">
                <Fact label={t('stats.items')}>{ta('card.items', { count: detail.itemCount })}</Fact>
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
          {grouped && grouping.groups.length > 1 && (
            <nav
              aria-labelledby={`${headingId}-outline`}
              className="min-w-0 rounded-xl border bg-card p-4 shadow-xs"
            >
              <h2 id={`${headingId}-outline`} className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ListTreeIcon className="size-4 text-muted-foreground" aria-hidden />
                {t('outline')}
              </h2>
              <ol className="grid max-h-[50vh] gap-0.5 overflow-y-auto text-sm lg:max-h-[calc(100vh-24rem)]">
                {grouping.groups.map((g) => (
                  <li key={g.id} className="min-w-0">
                    <a
                      href={`#${groupDomId(headingId, g)}`}
                      onClick={() => setOverrides((o) => ({ ...o, [g.id]: true }))}
                      className="flex min-w-0 items-baseline gap-2 rounded-md px-2 py-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="min-w-0 flex-1 truncate">{groupTitle(g)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {g.itemIds.length}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {detail.status === 'in_review' && detail.review && <ReviewCard detail={detail} />}
        </aside>

        <section
          aria-labelledby={`${headingId}-items`}
          className="grid min-w-0 gap-4 lg:col-start-1 lg:row-start-1"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-1">
              <h2 id={`${headingId}-items`} className="text-lg font-semibold">
                {grouped ? t('itemsByProcess') : t('itemsTitle')}
              </h2>
              {detail.items.length > 0 && (
                <KindCounts
                  processes={tally.processes}
                  kinds={tally.kinds}
                  kindLabel={kindLabel}
                  className="text-sm text-muted-foreground"
                />
              )}
              {grouped && <p className="text-xs text-muted-foreground">{t('orderHint')}</p>}
            </div>
            {grouped && collapsible && (
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
                  <ChevronsUpDownIcon /> {t('expandAll')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAll(false)}>
                  <ChevronsDownUpIcon /> {t('collapseAll')}
                </Button>
              </div>
            )}
          </div>
          {detail.items.length === 0 ? (
            <div className="rounded-xl border border-dashed">
              <EmptyState
                icon={<ListChecksIcon />}
                title={t('itemsEmpty')}
                description={t('itemsEmptyHint')}
              />
            </div>
          ) : grouped ? (
            <div className="grid min-w-0 gap-4">
              {grouping.groups.map((g) => (
                <GroupSection
                  key={g.id}
                  domId={groupDomId(headingId, g)}
                  title={groupTitle(g)}
                  hint={
                    g.type === 'process'
                      ? null
                      : t(g.type === 'shared' ? 'groups.sharedHint' : 'groups.otherHint')
                  }
                  summary={
                    g.type === 'process'
                      ? [
                          ...describe(planById.get(g.anchorId!)!),
                          // The checklists that assign the form, in their own words.
                          ...g.itemIds
                            .map((i) => planById.get(i)!)
                            .filter((i) => i.kind === 'scheduler.job')
                            .flatMap((i) => describe(i)),
                        ]
                      : []
                  }
                  items={g.itemIds.map((i) => byId.get(i)!)}
                  status={detail.status}
                  open={groupOpen(g)}
                  onOpenChange={(o) => setOverrides((x) => ({ ...x, [g.id]: o }))}
                  renderItem={(item) => card(item, 4)}
                />
              ))}
            </div>
          ) : (
            <ol className="grid min-w-0 gap-4">
              {items.map((item) => (
                <li key={item.id} className="min-w-0">
                  {card(item, 3)}
                </li>
              ))}
            </ol>
          )}
        </section>
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
        kindLabel={kindLabel}
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

/**
 * One process (a form with its approval and schedules), or the changes several processes share, or the rest: a
 * heading that opens and closes it, what it is in a sentence while closed, and its changes.
 */
function GroupSection({
  domId,
  title,
  hint,
  summary,
  items,
  status,
  open,
  onOpenChange,
  renderItem,
}: {
  domId: string;
  title: string;
  hint: string | null;
  summary: readonly string[];
  items: readonly ChangeSetItem[];
  status: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderItem: (item: ChangeSetItem) => ReactNode;
}) {
  const ta = useTranslations('assistant');
  const reduce = useReducedMotion();
  return (
    <section
      id={domId}
      aria-labelledby={`${domId}-title`}
      className={cn('min-w-0 scroll-mt-20 rounded-xl border bg-muted/30', open && 'pb-3')}
    >
      <h3 id={`${domId}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? `${domId}-items` : undefined}
          onClick={() => onOpenChange(!open)}
          className="flex w-full min-w-0 items-start gap-3 rounded-xl px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block text-base font-semibold break-words">{title}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{ta('card.items', { count: items.length })}</span>
              <span aria-hidden>·</span>
              <GroupStatus items={items} status={status} />
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              'mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </button>
      </h3>
      {!open && (summary.length > 0 || hint) && (
        <div className="grid gap-0.5 px-4 pb-3 text-sm text-muted-foreground">
          {(summary.length ? summary : [hint!]).map((line, i) => (
            <p key={i} className="min-w-0 break-words">
              {line}
            </p>
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${domId}-items`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.move }}
            className="overflow-hidden"
          >
            {hint && <p className="px-4 pb-2 text-sm text-muted-foreground">{hint}</p>}
            <ol className="grid min-w-0 gap-3 px-3">
              {items.map((item) => (
                <li key={item.id} className="min-w-0">
                  {renderItem(item)}
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
