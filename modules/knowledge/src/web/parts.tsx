'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import {
  ArchiveIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ClockIcon,
  EyeIcon,
  FileEditIcon,
  LockIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useMemo } from 'react';
import type { ArticleCard, ArticleLocale, ArticleStatus, CategoryRef } from '../contracts';

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

const STATUS: Record<
  ArticleStatus,
  { icon: typeof ClockIcon; variant: 'muted' | 'info' | 'success' | 'warning' }
> = {
  draft: { icon: FileEditIcon, variant: 'muted' },
  in_review: { icon: ClockIcon, variant: 'warning' },
  published: { icon: CheckCircle2Icon, variant: 'success' },
  retired: { icon: ArchiveIcon, variant: 'muted' },
};

/** Status is always icon + label + colour — never colour alone. */
export function StatusBadge({ status, className }: { status: ArticleStatus; className?: string }) {
  const t = useTranslations('knowledge.status');
  const { icon: Icon, variant } = STATUS[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden />
      {t(status)}
    </Badge>
  );
}

export function InternalBadge({ className }: { className?: string }) {
  const t = useTranslations('knowledge.audience');
  return (
    <Badge variant="info" className={className}>
      <LockIcon aria-hidden />
      {t('agents')}
    </Badge>
  );
}

export function LocaleChip({ locale, className }: { locale: ArticleLocale; className?: string }) {
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
          <LocaleChip locale={item.locale} />
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
