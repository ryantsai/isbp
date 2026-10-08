'use client';

import { Slot, useSlot } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowUpRightIcon,
  BoxIcon,
  CircleAlertIcon,
  EyeIcon,
  FileDiffIcon,
  LinkIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { type AssistantPreviewProps, type ChangeSetItem, REF_PREFIX } from '../../contracts';
import { CHECK, OpBadge, TEXT_TONE, ToneText } from '../badges';
import { Disclosure, PreviewBoundary } from '../disclosure';
import { type ChangeSetDetailDto, checkState, isRecord, type KindInfoDto, splitKind } from '../lib';
import { JsonDiff, ValueFields } from './json-diff';
import { LiveLinks, liveLinksOf } from './live-links';

/** The dry run of one item: passed, failing (with the reason and issues) or waiting for someone allowed to apply. */
function CheckResult({ item, status }: { item: ChangeSetItem; status: ChangeSetDetailDto['status'] }) {
  const t = useTranslations('assistant.item.check');
  const te = useTranslations('errors');
  if (status === 'applied') return <ToneText meta={CHECK.ok} label={t('applied')} />;
  if (status === 'rolled_back')
    return <ToneText meta={{ icon: Undo2Icon, tone: 'warning' }} label={t('rolledBack')} />;
  const state = checkState(item);
  const c = item.check;
  if (state === 'unchecked' || !c) return <ToneText meta={CHECK.unchecked} label={t('unchecked')} />;
  if (state === 'ok') return <ToneText meta={CHECK.ok} label={t('ok')} />;
  const headline =
    state === 'needsApprover'
      ? c.permission
        ? t('needsPermission', { permission: c.permission })
        : t('needsApprover')
      : c.code && te.has(c.code)
        ? t('failingWith', { reason: te(c.code) })
        : t('failing');
  const tone = state === 'needsApprover' ? 'info' : 'destructive';
  const Icon = CHECK[state].icon;
  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-lg px-3 py-2 text-sm',
        tone === 'info' ? 'bg-info/8' : 'bg-destructive/8',
      )}
    >
      <p className={cn('flex items-start gap-1.5 font-medium', TEXT_TONE[tone])}>
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{headline}</span>
      </p>
      {c.message && <p className="text-xs break-words text-foreground">{c.message}</p>}
      {c.issues.length > 0 && (
        <div className="grid gap-1">
          <p className={cn('text-xs font-medium', TEXT_TONE[tone])}>{t('issues')}</p>
          <ul className="grid gap-0.5 text-xs">
            {c.issues.map((i, n) => (
              <li key={`${i.path}-${n}`} className="min-w-0 break-words">
                {i.path && <code className="mr-1.5 font-mono">{i.path}</code>}
                {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.code && <p className="font-mono text-[11px] text-foreground">{c.code}</p>}
    </div>
  );
}

/** What the item changes, as a diff (update), the proposed value (create) or a note (archive, delete). */
function Changes({ item, status }: { item: ChangeSetItem; status: ChangeSetDetailDto['status'] }) {
  const t = useTranslations('assistant.item');
  const td = useTranslations('assistant.diff');
  const done = status === 'applied' || status === 'rolled_back';
  if (item.op === 'archive' || item.op === 'delete')
    return (
      <p className="flex items-start gap-2 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
        {t(done ? `${item.op}Done` : `${item.op}Note`)}
      </p>
    );
  if (item.op === 'create')
    return <ValueFields value={done ? (item.after?.value ?? item.value) : item.value} />;
  // An object created earlier in this change set: nothing to compare with yet.
  if (!done && item.targetId?.startsWith(REF_PREFIX)) return <ValueFields value={item.value} />;
  const before = done ? item.before?.value : item.current?.value;
  const after = done ? (item.after?.value ?? item.value) : item.value;
  if (before === undefined || (!done && !item.current))
    return (
      <div className="grid gap-2">
        <p className="text-xs text-muted-foreground">{t('currentUnavailable')}</p>
        <ValueFields value={after} />
      </div>
    );
  return (
    <JsonDiff
      before={before}
      after={after}
      labels={
        done ? { before: td('before'), after: td('after') } : { before: td('current'), after: td('proposed') }
      }
    />
  );
}

/** One change of a change set: what it is, its dry run, the diff, and the owning module's preview. */
export function ItemCard({
  item,
  detail,
  kind,
  kindLabel,
  onRemove,
  onRefresh,
  refreshing,
  first,
}: {
  item: ChangeSetItem;
  detail: ChangeSetDetailDto;
  kind: KindInfoDto | undefined;
  kindLabel: string;
  onRemove: (item: ChangeSetItem) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** The first item opens its preview. */
  first: boolean;
}) {
  const t = useTranslations('assistant.item');
  const td = useTranslations('assistant.diff');
  const id = useId();
  const { moduleId, name } = splitKind(item.kind);
  const previews = useSlot(`assistant.preview.${moduleId}.${name}`);
  const done = detail.status === 'applied' || detail.status === 'rolled_back';
  const canEdit = detail.permissions.canEdit;
  const refTarget = item.targetId?.startsWith(REF_PREFIX) ? item.targetId.slice(REF_PREFIX.length) : null;
  const objectHref = (done ? (item.after?.href ?? item.before?.href) : item.current?.href) ?? null;
  const previewValue = done ? (item.after?.value ?? item.value) : item.value;
  const preview: AssistantPreviewProps = {
    item,
    value: item.op === 'archive' || item.op === 'delete' ? null : previewValue,
    current: done ? item.before : item.current,
  };
  const raw = done ? (item.after?.value ?? item.value) : item.value;
  // Where people use the object now (a form's own page), besides its admin page.
  const live = liveLinksOf(detail.status, [item]);

  return (
    <article
      aria-labelledby={`${id}-title`}
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <div className="grid gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
          >
            {item.position + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <OpBadge op={item.op} />
              <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                {kind?.icon ? (
                  <DynamicIcon name={kind.icon as IconName} className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <BoxIcon className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate">{kindLabel}</span>
              </span>
            </div>
            <h3 id={`${id}-title`} className="text-base font-semibold break-words">
              <span className="sr-only">{t('position', { n: item.position + 1 })} </span>
              {item.label}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item.ref && (
                <span>
                  {t('ref')} <code className="font-mono text-foreground">{item.ref}</code>
                </span>
              )}
              {refTarget && (
                <span className="inline-flex items-center gap-1">
                  <LinkIcon className="size-3" aria-hidden />
                  {t('refTarget', { ref: refTarget })}
                </span>
              )}
              {item.targetId && !refTarget && (
                <span className="min-w-0 break-all">
                  {t('target')} <code className="font-mono">{item.targetId}</code>
                </span>
              )}
              {item.appliedId && item.op === 'create' && (
                <span className="min-w-0 break-all">
                  {t('createdId')} <code className="font-mono">{item.appliedId}</code>
                </span>
              )}
              {objectHref && (
                <Link
                  href={objectHref}
                  className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {t('openObject')}
                  <ArrowUpRightIcon className="size-3" aria-hidden />
                </Link>
              )}
              <LiveLinks links={live} showObject={false} />
            </div>
          </div>
          {canEdit && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-muted-foreground"
              onClick={() => onRemove(item)}
              aria-label={t('remove', { label: item.label })}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>

        <CheckResult item={item} status={detail.status} />

        {item.stale && (
          <div className="flex flex-col gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground sm:flex-row sm:items-center">
            <p className="flex min-w-0 flex-1 items-start gap-2">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('stale')}</span>
            </p>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRefresh}
                loading={refreshing}
                className="self-start"
              >
                {!refreshing && <RefreshCwIcon />}
                {t('refresh')}
              </Button>
            )}
          </div>
        )}

        {item.note && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <StickyNoteIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              <span className="sr-only">{t('note')}: </span>
              {item.note}
            </span>
          </p>
        )}
      </div>

      <Disclosure
        title={item.op === 'create' ? t('proposedValue') : done ? t('changesApplied') : t('changes')}
        icon={<FileDiffIcon />}
        defaultOpen
      >
        <Changes item={item} status={detail.status} />
        {isRecord(raw) && (
          <details className="mt-3">
            <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {td('raw')}
            </summary>
            <pre
              tabIndex={0}
              className="mt-1.5 max-h-96 overflow-auto rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 bg-muted/60 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
            >
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        )}
      </Disclosure>

      {previews.length > 0 && isRecord(preview.value) && (
        <Disclosure title={t('preview')} icon={<EyeIcon />} defaultOpen={first}>
          <PreviewBoundary fallback={<p className="text-sm text-muted-foreground">{t('previewFailed')}</p>}>
            <Slot<AssistantPreviewProps>
              name={`assistant.preview.${moduleId}.${name}`}
              props={preview}
              fallback={<Skeleton className="h-48 w-full rounded-lg" />}
            />
          </PreviewBoundary>
        </Disclosure>
      )}
    </article>
  );
}
