'use client';

import { Slot, useSlot } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowUpRightIcon,
  BoxIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  EyeIcon,
  FileDiffIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  WrenchIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { type AssistantPreviewProps, type ChangeSetItem, REF_PREFIX } from '../../contracts';
import { CHECK, type Meta, OpBadge, TEXT_TONE, ToneText } from '../badges';
import { Disclosure, PreviewBoundary } from '../disclosure';
import {
  type ChangeSetDetailDto,
  checkState,
  isRecord,
  type KindInfoDto,
  kindInSentence,
  splitKind,
} from '../lib';
import { JsonDiff, ValueFields } from './json-diff';
import { LiveLinks, liveLinksOf } from './live-links';
import { usePermissionName } from './permission-names';

/** Kinds whose preview opens by default: people read a form or a workflow by looking at it. */
const PREVIEW_OPEN = new Set(['core.form', 'core.workflow']);
/** The stagger of "Applied" chips after an apply: 30 ms apart, the first 10 only. */
const FLIP_STEP = 0.03;
const FLIP_MAX = 10;

type ChipState = 'applied' | 'rolledBack' | 'unchecked' | 'ok' | 'needsApprover' | 'failing';

function chipStateOf(item: ChangeSetItem, status: ChangeSetDetailDto['status']): ChipState {
  if (status === 'applied') return 'applied';
  if (status === 'rolled_back') return 'rolledBack';
  return checkState(item);
}

const CHIP_META: Record<ChipState, Meta> = {
  applied: CHECK.ok,
  rolledBack: { icon: Undo2Icon, tone: 'warning' },
  unchecked: CHECK.unchecked,
  ok: CHECK.ok,
  needsApprover: CHECK.needsApprover,
  failing: CHECK.failing,
};

/**
 * The item's state in a word or two ("Ready to apply", "Can't be applied", "Applied"). After an apply it flips to
 * "Applied" with a short stagger (`flipDelay`), so the person sees every change land together.
 */
export function CheckChip({
  item,
  status,
  flipDelay,
}: {
  item: ChangeSetItem;
  status: ChangeSetDetailDto['status'];
  /** Seconds to wait before the chip changes (the item's place in the stagger), or undefined for no animation. */
  flipDelay?: number;
}) {
  const t = useTranslations('assistant.item.check');
  const permissionName = usePermissionName();
  const reduce = useReducedMotion();
  const state = chipStateOf(item, status);
  const label =
    state === 'needsApprover'
      ? item.check?.permission
        ? t('needsPermission', { permission: permissionName(item.check.permission) })
        : t('needsApprover')
      : t(state);
  const chip = <ToneText meta={CHIP_META[state]} label={label} className="whitespace-normal" />;
  if (reduce || flipDelay === undefined) return chip;
  return (
    <span className="inline-grid min-w-0">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          className="col-start-1 row-start-1 min-w-0"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: duration.fast, ease: ease.exit } }}
          transition={{ duration: duration.fast, ease: ease.enter, delay: flipDelay }}
        >
          {chip}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The flip delay of the n-th item in an apply stagger. */
export const flipDelayOf = (index: number) => Math.min(index, FLIP_MAX) * FLIP_STEP;

/** Why the dry run failed or who can apply it, with the problems it found. Nothing when it passed. */
function CheckDetails({ item, status }: { item: ChangeSetItem; status: ChangeSetDetailDto['status'] }) {
  const t = useTranslations('assistant.item.check');
  const te = useTranslations('errors');
  const permissionName = usePermissionName();
  const state = checkState(item);
  const c = item.check;
  if (
    status === 'applied' ||
    status === 'rolled_back' ||
    !c ||
    (state !== 'failing' && state !== 'needsApprover')
  )
    return null;
  const headline =
    state === 'needsApprover'
      ? c.permission
        ? t('needsPermission', { permission: permissionName(c.permission) })
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
    </div>
  );
}

/** What an update changes, as a diff; a note for archives and deletes. */
function Differences({ item, status }: { item: ChangeSetItem; status: ChangeSetDetailDto['status'] }) {
  const t = useTranslations('assistant.item');
  const td = useTranslations('assistant.diff');
  const done = status === 'applied' || status === 'rolled_back';
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

/** Reference name, ids, the kind's code, every property and the JSON: for administrators who need them. */
function TechnicalDetails({ item, status }: { item: ChangeSetItem; status: ChangeSetDetailDto['status'] }) {
  const t = useTranslations('assistant.item');
  const td = useTranslations('assistant.diff');
  const done = status === 'applied' || status === 'rolled_back';
  const raw = done ? (item.after?.value ?? item.value) : item.value;
  const refTarget = item.targetId?.startsWith(REF_PREFIX) ? item.targetId.slice(REF_PREFIX.length) : null;
  const facts: [string, ReactNode][] = [
    [t('technical.kind'), <code key="k">{item.kind}</code>],
    ...(item.ref ? [[t('ref'), <code key="r">{item.ref}</code>] as [string, ReactNode]] : []),
    ...(refTarget ? [[t('target'), t('refTarget', { ref: refTarget })] as [string, ReactNode]] : []),
    ...(item.targetId && !refTarget
      ? [[t('target'), <code key="t">{item.targetId}</code>] as [string, ReactNode]]
      : []),
    ...(item.appliedId && item.op === 'create'
      ? [[t('createdId'), <code key="c">{item.appliedId}</code>] as [string, ReactNode]]
      : []),
  ];
  return (
    <div className="grid gap-3">
      <dl className="grid gap-1 text-xs">
        {facts.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {item.op === 'create' && <ValueFields value={raw} />}
      {isRecord(raw) && (
        <details>
          <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {td('raw')}
          </summary>
          <pre
            tabIndex={0}
            className="mt-1.5 max-h-96 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * One change of a change set: what it does in plain words, whether it can be applied, and — when opened — the
 * owning module's preview, the differences of an update and the technical details. The body collapses on long
 * change sets; failing changes open themselves.
 */
export function ItemCard({
  item,
  number,
  detail,
  kind,
  kindLabel,
  lines,
  defaultOpen,
  canRemove,
  onRemove,
  onRefresh,
  refreshing,
  flipDelay,
  headingLevel = 3,
}: {
  item: ChangeSetItem;
  /** Its place in the order the changes apply (1-based). */
  number: number;
  detail: ChangeSetDetailDto;
  kind: KindInfoDto | undefined;
  kindLabel: string;
  /** What it does, in plain sentences. */
  lines: readonly string[];
  defaultOpen: boolean;
  canRemove: boolean;
  onRemove: (item: ChangeSetItem) => void;
  onRefresh: () => void;
  refreshing: boolean;
  flipDelay?: number;
  headingLevel?: 3 | 4;
}) {
  const t = useTranslations('assistant.item');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const id = useId();
  const { moduleId, name } = splitKind(item.kind);
  const previews = useSlot(`assistant.preview.${moduleId}.${name}`);
  const state = checkState(item);
  const [open, setOpen] = useState(defaultOpen || (state === 'failing' && detail.status === 'draft'));
  const done = detail.status === 'applied' || detail.status === 'rolled_back';
  const canEdit = detail.permissions.canEdit;
  // Nothing to open once rolled back (a created object is gone, an updated one is as it was).
  const objectHref =
    detail.status === 'rolled_back' ? null : ((done ? item.after?.href : item.current?.href) ?? null);
  const previewValue = done ? (item.after?.value ?? item.value) : item.value;
  const preview: AssistantPreviewProps = {
    item,
    value: item.op === 'archive' || item.op === 'delete' ? null : previewValue,
    current: done ? item.before : item.current,
    items: detail.items,
  };
  // Where people use the object now (a form's own page), besides its admin page.
  const live = liveLinksOf(detail.status, [item]);
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const sub = headingLevel === 3 ? 4 : 5;
  const hasPreview = previews.length > 0 && isRecord(preview.value);

  return (
    <article aria-labelledby={`${id}-title`} className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex min-w-0 items-start gap-3 p-4">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums"
        >
          {number}
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
            <CheckChip item={item} status={detail.status} flipDelay={flipDelay} />
          </div>
          <Heading id={`${id}-title`} className="text-base font-semibold break-words">
            <span className="sr-only">{t('position', { n: number })} </span>
            {item.label}
          </Heading>
          {lines.length > 0 && (
            <div className="grid gap-0.5 text-sm text-muted-foreground">
              {lines.map((line, i) => (
                <p key={i} className="min-w-0 break-words">
                  {line}
                </p>
              ))}
            </div>
          )}
          {(objectHref || live.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {objectHref && (
                <Link
                  href={objectHref}
                  className="inline-flex items-center gap-0.5 rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {t('openKind', { kind: kindInSentence(kindLabel, locale) })}
                  <ArrowUpRightIcon className="size-3" aria-hidden />
                </Link>
              )}
              <LiveLinks links={live} showObject={false} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canEdit && canRemove && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onRemove(item)}
              aria-label={t('remove', { label: item.label })}
            >
              <Trash2Icon />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-expanded={open}
            aria-controls={open ? `${id}-body` : undefined}
            aria-label={t(open ? 'hideDetails' : 'showDetails', { label: item.label })}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDownIcon
              className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')}
            />
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-body`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.move }}
            className="overflow-hidden"
          >
            {(state === 'failing' || state === 'needsApprover' || item.stale || item.note) && !done && (
              <div className="grid gap-3 px-4 pb-4">
                <CheckDetails item={item} status={detail.status} />
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
                {item.note && <Note text={item.note} />}
              </div>
            )}
            {done && item.note && (
              <div className="px-4 pb-4">
                <Note text={item.note} />
              </div>
            )}

            {(item.op === 'archive' || item.op === 'delete') && (
              <p className="flex items-start gap-2 border-t px-4 py-3 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                {t(done ? `${item.op}Done` : `${item.op}Note`)}
              </p>
            )}

            {item.op === 'update' && (
              <Disclosure
                title={done ? t('changesApplied') : t('changes')}
                icon={<FileDiffIcon />}
                level={sub}
                defaultOpen
              >
                <Differences item={item} status={detail.status} />
              </Disclosure>
            )}

            {hasPreview && (
              <Disclosure
                title={t('preview')}
                icon={<EyeIcon />}
                level={sub}
                defaultOpen={PREVIEW_OPEN.has(item.kind)}
              >
                <PreviewBoundary
                  fallback={<p className="text-sm text-muted-foreground">{t('previewFailed')}</p>}
                >
                  <Slot<AssistantPreviewProps>
                    name={`assistant.preview.${moduleId}.${name}`}
                    props={preview}
                    fallback={<Skeleton className="h-48 w-full rounded-lg" />}
                  />
                </PreviewBoundary>
              </Disclosure>
            )}

            <Disclosure title={t('technical.title')} icon={<WrenchIcon />} level={sub}>
              <TechnicalDetails item={item} status={detail.status} />
            </Disclosure>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function Note({ text }: { text: string }) {
  const t = useTranslations('assistant.item');
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <StickyNoteIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        <span className="sr-only">{t('note')}: </span>
        {text}
      </span>
    </p>
  );
}
