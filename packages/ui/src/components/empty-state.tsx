'use client';

import { Button } from '@astryxdesign/core/Button';
import { EmptyState as AstryxEmptyState } from '@astryxdesign/core/EmptyState';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ApiError } from '@isbp/sdk/web';
import { CloudAlertIcon, FilterXIcon, LockIcon, RotateCwIcon, SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { IconTile } from './icon-tile';
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
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'filtered' | 'compact';
  /** With `variant="filtered"`: shows a Clear filters button. */
  onClearFilters?: () => void;
  className?: string;
}) {
  const t = useTranslations('ui.empty');
  if (variant === 'compact')
    return (
      <HStack gap={3} wrap="wrap" vAlign="center" className={className}>
        {icon && (
          <Text color="secondary" className="inline-flex shrink-0 [&_svg]:size-4" aria-hidden>
            {icon}
          </Text>
        )}
        <Text color="secondary">{title}</Text>
        {description && <Text color="secondary">{description}</Text>}
        {action}
      </HStack>
    );
  const filtered = variant === 'filtered';
  const shownIcon = icon ?? (filtered ? <FilterXIcon /> : null);
  const shownDescription = description ?? (filtered ? t('filteredDescription') : undefined);
  const clear =
    filtered && onClearFilters ? (
      <Button label={t('clearFilters')} variant="secondary" size="sm" onClick={onClearFilters} />
    ) : null;
  return (
    <AstryxEmptyState
      className={className}
      headingLevel={2}
      title={title ?? (filtered ? t('filteredTitle') : '')}
      description={shownDescription}
      icon={
        shownIcon ? (
          <IconTile aria-hidden className="text-muted-foreground">
            {shownIcon}
          </IconTile>
        ) : undefined
      }
      actions={
        action || clear ? (
          <HStack gap={2} wrap="wrap" hAlign="center" vAlign="center">
            {action}
            {clear}
          </HStack>
        ) : undefined
      }
    />
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
      <Button
        label={t('retry')}
        variant="secondary"
        size="sm"
        icon={<AstryxIcon icon={RotateCwIcon} />}
        onClick={onRetry}
      />
    ) : null;
  const GlyphIcon = forbidden ? LockIcon : notFound ? SearchXIcon : CloudAlertIcon;
  if (compact)
    return (
      <HStack role="alert" gap={3} wrap="wrap" vAlign="center" className={className}>
        <AstryxIcon icon={GlyphIcon} color="secondary" />
        <Text weight="medium">{heading}</Text>
        <Text color="secondary">{detail}</Text>
        {retry}
      </HStack>
    );
  return (
    <VStack role="alert" gap={3} hAlign="center" className={cn('px-6 py-10 text-center', className)}>
      <IconTile aria-hidden className={forbidden || notFound ? 'text-muted-foreground' : 'text-destructive'}>
        <GlyphIcon />
      </IconTile>
      <VStack gap={1} hAlign="center" className="max-w-sm">
        <Text as="p" type="large" weight="semibold">
          {heading}
        </Text>
        <Text as="p" color="secondary" justify="center">
          {detail}
        </Text>
      </VStack>
      {retry}
    </VStack>
  );
}
