'use client';

import { ApiError } from '@isbp/sdk/web';
import { CloudAlertIcon, FilterXIcon, LockIcon, RotateCwIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { useErrorText } from './query';

/**
 * Nothing to show. Pick the copy by who is looking: people who can create get "No X yet" + the `action`; people who
 * can't get what will appear here and why, and **no** `action` (check `useCan` before passing one).
 * `variant="filtered"` is the "no results match these filters" state (title and Clear filters button built in);
 * `variant="compact"` is one line for a panel or card.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  onClearFilters,
  className,
}: {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: 'default' | 'filtered' | 'compact';
  /** With `variant="filtered"`: shows a Clear filters button. */
  onClearFilters?: () => void;
  className?: string;
}) {
  const t = useTranslations('ui.empty');
  if (variant === 'compact')
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm text-muted-foreground',
          className,
        )}
      >
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
        <span>{title}</span>
        {description && <span>{description}</span>}
        {action}
      </div>
    );
  const filtered = variant === 'filtered';
  const shownIcon = icon ?? (filtered ? <FilterXIcon /> : null);
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      {shownIcon && (
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {shownIcon}
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium">{title ?? (filtered ? t('filteredTitle') : null)}</p>
        {(description ?? (filtered ? t('filteredDescription') : null)) && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description ?? t('filteredDescription')}
          </p>
        )}
      </div>
      {action}
      {filtered && onClearFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          {t('clearFilters')}
        </Button>
      )}
    </div>
  );
}

/** HTTP status of a failed request, when known. */
function statusOf(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined;
}

/**
 * A request failed: says what couldn't load and offers Retry. A 403 says "you don't have access" (no retry), a 404
 * "not found". Never show an empty state for a failed request. Announced to screen readers (`role="alert"`).
 * `DataTable` renders it for you when given `error`.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  kind = 'section',
  compact,
  className,
}: {
  error?: unknown;
  onRetry?: () => void;
  /** Overrides the default title. */
  title?: React.ReactNode;
  /** `list` → "Couldn't load this list"; `page`/`section` → "Couldn't load this". */
  kind?: 'list' | 'page' | 'section';
  /** One line, for a card or panel. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('ui.error');
  const errorText = useErrorText();
  const status = statusOf(error);
  const forbidden = status === 403;
  const notFound = status === 404;
  const heading =
    title ??
    (forbidden
      ? t('forbiddenTitle')
      : notFound
        ? t('notFoundTitle')
        : kind === 'list'
          ? t('listTitle')
          : t('title'));
  const detail = forbidden
    ? t('forbiddenDescription')
    : notFound
      ? t('notFoundDescription')
      : errorText(error);
  const retry =
    onRetry && !forbidden && !notFound ? (
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCwIcon />
        {t('retry')}
      </Button>
    ) : null;
  const Icon = forbidden ? LockIcon : notFound ? SearchXIcon : CloudAlertIcon;
  if (compact)
    return (
      <div role="alert" className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm', className)}>
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{heading}</span>
        <span className="text-muted-foreground">{detail}</span>
        {retry}
      </div>
    );
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}
    >
      <div
        className={cn(
          'flex size-11 items-center justify-center rounded-full [&_svg]:size-5',
          forbidden || notFound ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive',
        )}
      >
        <Icon aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{heading}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{detail}</p>
      </div>
      {retry}
    </div>
  );
}
