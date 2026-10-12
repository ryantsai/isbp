'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { type SectionTab, SectionTabs } from '@isbp/ui/section-tabs';
import { defineStatusMap, MappedStatus, StatusBadge as Chip } from '@isbp/ui/status';
import {
  ArchiveIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ClockIcon,
  EyeIcon,
  FileEditIcon,
  LockIcon,
  PaperclipIcon,
  ShieldAlertIcon,
  ShieldIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useApiQuery } from '@isbp/ui/query';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useCallback, useMemo } from 'react';
import type {
  ArticleCard,
  ArticleLocale,
  ArticleStatus,
  CategoryRef,
  ClassificationLevel,
  Classifications,
} from '../contracts';

/** Short labels for language chips (each language names itself). */
export const LOCALE_LABEL: Record<ArticleLocale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
  'ja-JP': '日本語',
};
export const LOCALE_SHORT: Record<ArticleLocale, string> = { en: 'EN', 'zh-TW': '繁中', 'ja-JP': '日本語' };
export const LOCALE_LANG: Record<ArticleLocale, string> = { en: 'en', 'zh-TW': 'zh-Hant-TW', 'ja-JP': 'ja' };

/** Category icon by lucide name (falls back to a book). */
export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return <BookOpenIcon className={className} aria-hidden />;
  return (
    <DynamicIcon
      name={name as IconName}
      className={className}
      aria-hidden
      fallback={() => <BookOpenIcon className={className} aria-hidden />}
    />
  );
}

const ARTICLE_STATUS = defineStatusMap<ArticleStatus>({
  draft: { tone: 'muted', icon: FileEditIcon, labelKey: 'draft' },
  in_review: { tone: 'warning', icon: ClockIcon, labelKey: 'in_review' },
  published: { tone: 'success', icon: CheckCircle2Icon, labelKey: 'published' },
  retired: { tone: 'muted', icon: ArchiveIcon, labelKey: 'retired' },
});

/** Status is always icon + label + colour — never colour alone. `animate` cross-fades a change in place. */
export function StatusBadge({
  status,
  animate,
  className,
}: {
  status: ArticleStatus;
  animate?: boolean;
  className?: string;
}) {
  const t = useTranslations('knowledge.status');
  return (
    <MappedStatus
      map={ARTICLE_STATUS}
      value={status}
      t={(key) => t(key as ArticleStatus)}
      animate={animate}
      className={className}
    />
  );
}

/** "Agents only": who can read it (an attribute, not a status: a neutral outline chip with a lock). */
export function InternalBadge({ className }: { className?: string }) {
  const t = useTranslations('knowledge.audience');
  return <Chip tone="neutral" icon={LockIcon} label={t('agents')} className={className} />;
}

/**
 * The article's language as a small chip; `foreignOnly` shows it only when it isn't the reader's UI language (an
 * English reader doesn't need "EN" on every row).
 */
export function LocaleChip({
  locale,
  foreignOnly,
  className,
}: {
  locale: ArticleLocale;
  foreignOnly?: boolean;
  className?: string;
}) {
  const ui = useLocale();
  if (foreignOnly && locale === ui) return null;
  return (
    <span
      lang={LOCALE_LANG[locale]}
      title={LOCALE_LABEL[locale]}
      className={cn(
        'inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {LOCALE_SHORT[locale]}
    </span>
  );
}

/* ───────────── sections ───────────── */

/**
 * Browse | Manage | Categories under the page header of the knowledge home, the management list and the categories
 * page: each tab is its own page. Only people who can write or manage categories get the strip (readers have one
 * page). Header buttons that would repeat a tab don't exist.
 */
export function KnowledgeSections() {
  const t = useTranslations('knowledge.sections');
  const canWrite = useCan('knowledge.articles.write');
  const canManageCategories = useCan('knowledge.categories.manage');
  const items: SectionTab[] = [{ href: '/knowledge', label: t('browse'), match: 'exact' }];
  if (canWrite) items.push({ href: '/knowledge/manage', label: t('manage') });
  if (canManageCategories) items.push({ href: '/knowledge/categories', label: t('categories') });
  if (items.length < 2) return null;
  return <SectionTabs items={items} label={t('label')} />;
}

/**
 * Article text (reading and preview): tables keep whole words in their cells and scroll sideways in their own box
 * when they don't fit (the first column stays at least 8rem wide), instead of breaking words mid-word on a phone.
 */
export const ARTICLE_PROSE = 'text-[15px] [&_:is(td,th)]:wrap-break-word [&_:is(td,th):first-child]:min-w-32';

/* ───────────── classification ───────────── */

const NO_LEVELS: ClassificationLevel[] = [];

/**
 * The classification labels in use (most restrictive first) and how to show one: built-in keys translated, custom
 * labels as written; the tone follows the rank (the most restrictive is the strongest).
 */
export function useClassifications() {
  const t = useTranslations('knowledge.classificationLevel');
  const { data } = useApiQuery<Classifications>('/knowledge/classifications');
  const levels = data?.items ?? NO_LEVELS;
  const label = useCallback(
    (key: string) => (t.has(key as 'confidential') ? t(key as 'confidential') : key),
    [t],
  );
  const tone = useCallback(
    (key: string): 'destructive' | 'warning' | 'info' | 'muted' => {
      const level = levels.find((l) => l.key === key);
      if (!level) return 'muted';
      if (level.rank === 0) return 'destructive';
      if (level.rank === 1) return 'warning';
      return level.rank === levels.length - 1 && levels.length > 2 ? 'muted' : 'info';
    },
    [levels],
  );
  return { levels, label, tone };
}

/** The article's classification label: icon + text + tone (never colour alone). */
export function ClassificationBadge({ value, className }: { value: string; className?: string }) {
  const t = useTranslations('knowledge.classification');
  const { label, tone } = useClassifications();
  const variant = tone(value);
  const Icon = variant === 'destructive' || variant === 'warning' ? ShieldAlertIcon : ShieldIcon;
  return (
    <Chip
      tone={variant}
      icon={Icon}
      title={`${t('label')}: ${label(value)}`}
      className={className}
      label={
        <>
          <span className="sr-only">{t('label')}: </span>
          {label(value)}
        </>
      }
    />
  );
}

export function useCategoryName() {
  const locale = useLocale();
  return (c: Pick<CategoryRef, 'name' | 'key'> | null | undefined) =>
    c ? localize(c.name, locale) || c.key : '';
}

/* ───────────── safe highlighting (split text, never innerHTML) ───────────── */

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** Words (2+ letters) and CJK runs (plus their bigrams) of a query. */
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (CJK.test(token)) {
      terms.add(token);
      const chars = [...token];
      for (let i = 0; i + 1 < chars.length; i++) terms.add(chars[i]! + chars[i + 1]!);
    } else if (token.length >= 2) terms.add(token);
  }
  return [...terms].sort((a, b) => b.length - a.length).slice(0, 12);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renders `text` with the query's terms in bold. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const terms = queryTerms(query);
    if (!terms.length) return [text];
    return text.split(new RegExp(`(${terms.map(escapeRe).join('|')})`, 'giu'));
  }, [text, query]);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-primary/10 px-0.5 font-semibold text-foreground">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/* ───────────── article rows ───────────── */

/** A search hit or related article: title, snippet, category and language. */
export function ArticleHit({
  item,
  query = '',
  compact,
  onKeyDown,
}: {
  item: ArticleCard;
  query?: string;
  compact?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLAnchorElement>;
}) {
  const categoryName = useCategoryName();
  const t = useTranslations('knowledge.search');
  return (
    <Link
      href={item.href}
      onKeyDown={onKeyDown}
      data-hit
      className="group flex min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
        <CategoryIcon name={item.category?.icon} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium group-hover:underline" lang={LOCALE_LANG[item.locale]}>
            <Highlight text={item.title} query={query} />
          </span>
          {item.audience === 'agents' && <InternalBadge className="shrink-0" />}
          {item.classification && <ClassificationBadge value={item.classification} className="shrink-0" />}
        </span>
        {!compact && (
          <span className="line-clamp-2 text-sm text-muted-foreground" lang={LOCALE_LANG[item.locale]}>
            <Highlight text={item.snippet || item.summary} query={query} />
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{item.reference}</span>
          {item.category && (
            <>
              <span aria-hidden>·</span>
              <span>{categoryName(item.category)}</span>
            </>
          )}
          <LocaleChip locale={item.locale} foreignOnly />
          {item.attachment && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <Icon icon={PaperclipIcon} size="xsm" />
                <span className="truncate">
                  {item.attachment.page
                    ? t('inAttachmentPage', { name: item.attachment.name, page: item.attachment.page })
                    : t('inAttachment', { name: item.attachment.name })}
                </span>
              </span>
            </>
          )}
        </span>
      </span>
    </Link>
  );
}

/** Views and helpfulness, e.g. on list rows. */
export function ArticleStats({
  views,
  helpful,
  notHelpful,
  className,
}: {
  views: number;
  helpful: number;
  notHelpful: number;
  className?: string;
}) {
  const t = useTranslations('knowledge.stats');
  const locale = useLocale();
  const votes = helpful + notHelpful;
  return (
    <span className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
      <span className="inline-flex items-center gap-1" title={t('views', { count: views })}>
        <EyeIcon className="size-3.5" aria-hidden />
        <span className="sr-only">{t('views', { count: views })}</span>
        <span aria-hidden className="tabular-nums">
          {views.toLocaleString(locale)}
        </span>
      </span>
      {votes > 0 && (
        <span
          className="inline-flex items-center gap-1"
          title={t('helpfulShare', { percent: Math.round((helpful / votes) * 100) })}
        >
          <ThumbsUpIcon className="size-3.5" aria-hidden />
          <span className="sr-only">
            {t('helpfulShare', { percent: Math.round((helpful / votes) * 100) })}
          </span>
          <span aria-hidden className="tabular-nums">
            {Math.round((helpful / votes) * 100)}%
          </span>
        </span>
      )}
    </span>
  );
}
