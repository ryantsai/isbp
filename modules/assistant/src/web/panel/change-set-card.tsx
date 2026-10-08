'use client';

import { useApiQuery } from '@isbp/ui/query';
import { ArrowRightIcon, GitPullRequestArrowIcon } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { changeSetHref } from '../../contracts';
import { CHECK, StatusBadge, ToneText } from '../badges';
import { LiveLinks, liveLinksOf } from '../change-set/live-links';
import {
  type ChangeSetDetailDto,
  type ChangeSetSummaryDto,
  changeSetApiPath,
  checkCounts,
  isOpenStatus,
} from '../lib';

/**
 * "Change set CS-00012 · 3 changes · ready / 1 failing", kept current while the assistant proposes changes
 * (`change_set` events refresh it), with the way to the change set page.
 */
export function ChangeSetCard({
  id,
  summary,
  onNavigate,
}: {
  id: string;
  summary?: ChangeSetSummaryDto | null;
  onNavigate?: () => void;
}) {
  const t = useTranslations('assistant.card');
  const { data } = useApiQuery<ChangeSetDetailDto>(changeSetApiPath(id));
  const detail = data && data.id === id ? data : null;
  const cs = detail ?? (summary && summary.id === id ? summary : null);
  if (!cs) return null;
  const counts = detail ? checkCounts(detail.items) : null;
  const open = isOpenStatus(cs.status);
  const live = detail ? liveLinksOf(detail.status, detail.items) : [];

  let readiness: ReactNode = null;
  if (open && cs.itemCount > 0) {
    if (counts) {
      const parts: ReactNode[] = [];
      if (counts.failing)
        parts.push(<ToneText key="f" meta={CHECK.failing} label={t('failing', { count: counts.failing })} />);
      if (counts.needsApprover)
        parts.push(
          <ToneText
            key="n"
            meta={CHECK.needsApprover}
            label={t('needsApprover', { count: counts.needsApprover })}
          />,
        );
      if (counts.unchecked) parts.push(<ToneText key="u" meta={CHECK.unchecked} label={t('unchecked')} />);
      readiness = parts.length ? parts : <ToneText meta={CHECK.ok} label={t('ready')} />;
    } else
      readiness = cs.ready ? (
        <ToneText meta={CHECK.ok} label={t('ready')} />
      ) : (
        <ToneText meta={CHECK.unchecked} label={t('notReady')} />
      );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      aria-label={t('title', { reference: cs.reference })}
      className="grid min-w-0 gap-1.5 rounded-xl border bg-card px-3.5 py-3 shadow-xs"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <GitPullRequestArrowIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="text-sm font-semibold">{t('title', { reference: cs.reference })}</span>
        <StatusBadge status={cs.status} />
      </div>
      {cs.title && <p className="truncate text-sm">{cs.title}</p>}
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        role="status"
      >
        <span>{t('items', { count: cs.itemCount })}</span>
        {readiness && (
          <>
            <span aria-hidden>·</span>
            {readiness}
          </>
        )}
      </div>
      {live.length > 0 && <LiveLinks links={live} className="text-sm" />}
      <Link
        href={changeSetHref(id)}
        onClick={onNavigate}
        className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {open ? t('open') : t('view')}
        <ArrowRightIcon className="size-3.5" aria-hidden />
      </Link>
    </motion.section>
  );
}
