'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ArrowLeftIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { pathOf, recallListHref, rememberOpenedRow } from '../lib/list-memory';
import { cn } from '../lib/utils';
import { IconTile } from './icon-tile';

const noopSubscribe = () => () => {};

/** Tailwind's `sm` breakpoint (40 rem). */
const WIDE = '(min-width: 40rem)';
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
/** Whether the screen is at least `sm` wide. The server (and first paint) answer "phone". */
function useWide() {
  return React.useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * "← Hardware": goes back to a list **as the person left it** (its filters, page and sort are remembered per list by
 * `useListState`), and asks the list to highlight the record they came from (`highlight` = the list's row id,
 * matching its `DataTable` `getRowId`). The label is always the list's name.
 */
export function BackLink({
  href,
  label,
  highlight,
  className,
}: {
  /** The list's path (`/itam/hardware`). A query string here is used as is. */
  href: string;
  label: React.ReactNode;
  highlight?: string;
  className?: string;
}) {
  const target = React.useSyncExternalStore(
    noopSubscribe,
    () => recallListHref(href),
    () => href,
  );
  return (
    <Link
      href={target}
      color="secondary"
      isStandalone
      size="sm"
      onClick={() => {
        if (highlight) rememberOpenedRow(pathOf(href), highlight);
      }}
      className={cn('w-fit max-w-full', className)}
    >
      {/* No `max-w-full` here: a percentage max-width inside a shrink-to-fit item sizes it to its narrowest wrap. */}
      <span className="-ml-1 inline-flex items-center gap-1">
        <Icon icon={ArrowLeftIcon} size="sm" />
        <span>{label}</span>
      </span>
    </Link>
  );
}

/** List and hub pages: title, one-line description, primary action top-right. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** A back link above the title (sub-pages of a hub). */
  back?: { href: string; label: React.ReactNode };
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 pb-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <VStack gap={0.5} className="min-w-0">
        {back && <BackLink href={back.href} label={back.label} className="mb-1" />}
        {eyebrow && (
          <Text as="div" type="supporting">
            {eyebrow}
          </Text>
        )}
        <Heading level={1} className="wrap-break-word">
          {title}
        </Heading>
        {description && (
          <Text as="p" type="supporting" className="max-w-3xl">
            {description}
          </Text>
        )}
      </VStack>
      {actions && (
        <HStack gap={2} wrap="wrap" vAlign="center" className="shrink-0">
          {actions}
        </HStack>
      )}
    </div>
  );
}

/** An action of a `DetailHeader` (secondary buttons and the "More" menu). */
export interface DetailAction {
  /** Stable key; defaults to the label. */
  id?: string;
  label: string;
  icon?: React.ReactNode;
  /** Runs the action (open a sheet, a confirmation…). */
  onSelect?: () => void;
  /** Or navigates. */
  href?: string;
  disabled?: boolean;
  /** Destructive actions go last in the menu, after a separator, in red. Never a plain header button. */
  destructive?: boolean;
}

/** A `DetailAction` as an item of Astryx's menu data form. */
function menuItem(a: DetailAction) {
  return {
    id: a.id ?? a.label,
    label: a.label,
    icon: a.icon,
    onClick: a.onSelect,
    href: a.disabled ? undefined : a.href,
    isDisabled: a.disabled,
    variant: a.destructive ? ('destructive' as const) : ('default' as const),
  };
}

/**
 * Detail pages: back link → reference · type → title (wraps, never truncated) → status and badges → one meta line,
 * with the actions top-right: `primaryAction` (the next step; always visible), up to 2 `actions` as secondary
 * buttons (moved into "More" on a phone), and `menu` (everything else, destructive last). `children` are extra
 * controls placed before the primary action (e.g. a status menu).
 */
export function DetailHeader({
  back,
  icon,
  reference,
  title,
  status,
  badges,
  meta,
  primaryAction,
  actions = [],
  menu = [],
  children,
  className,
}: {
  back?: { href: string; label: React.ReactNode; highlight?: string };
  icon?: React.ReactNode;
  reference?: React.ReactNode;
  title: React.ReactNode;
  status?: React.ReactNode;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  primaryAction?: React.ReactNode;
  actions?: readonly DetailAction[];
  menu?: readonly DetailAction[];
  children?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('ui.detail');
  const visible = actions.slice(0, 2);
  const overflow = [...actions.slice(2), ...menu];
  const plain = overflow.filter((a) => !a.destructive);
  const destructive = overflow.filter((a) => a.destructive);
  const hasMenu = overflow.length > 0;
  const wide = useWide();

  /** Menu items: plain ones, then destructive ones after a divider. */
  const tail = [
    ...plain.map(menuItem),
    ...(destructive.length > 0 && plain.length > 0 ? [{ type: 'divider' as const }] : []),
    ...destructive.map(menuItem),
  ];
  // On a phone the visible actions move into the menu, ahead of the rest; wider screens show them as buttons.
  const phoneItems = [
    ...visible.map(menuItem),
    ...(visible.length > 0 && tail.length > 0 ? [{ type: 'divider' as const }] : []),
    ...tail,
  ];

  return (
    <header className={cn('flex flex-col gap-2 pb-4', className)}>
      {back && <BackLink href={back.href} label={back.label} highlight={back.highlight} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <HStack gap={3} vAlign="start" className="min-w-0">
          {icon && <IconTile aria-hidden>{icon}</IconTile>}
          <VStack gap={1} className="min-w-0">
            {reference && (
              <Text as="div" type="supporting" className="wrap-break-word">
                {reference}
              </Text>
            )}
            <Heading level={1} className="wrap-break-word">
              {title}
            </Heading>
            {(status || badges) && (
              <HStack gap={2} wrap="wrap" vAlign="center">
                {status}
                {badges}
              </HStack>
            )}
            {meta && (
              <Text as="div" type="supporting">
                {meta}
              </Text>
            )}
          </VStack>
        </HStack>
        {(primaryAction || children || visible.length > 0 || hasMenu) && (
          <HStack gap={2} wrap="wrap" vAlign="center" className="shrink-0">
            {children}
            {visible.map((a) =>
              a.href && !a.disabled ? (
                <Button
                  key={a.id ?? a.label}
                  label={a.label}
                  variant="secondary"
                  icon={a.icon}
                  href={a.href}
                  className="hidden sm:inline-flex"
                />
              ) : (
                <Button
                  key={a.id ?? a.label}
                  label={a.label}
                  variant="secondary"
                  icon={a.icon}
                  isDisabled={a.disabled}
                  onClick={a.onSelect}
                  className="hidden sm:inline-flex"
                />
              ),
            )}
            {primaryAction}
            {/* One menu, never two in the DOM: on a phone it also holds the actions that wider screens show as buttons. */}
            {(hasMenu || (!wide && visible.length > 0)) && (
              <div className={cn(!hasMenu && 'sm:hidden')}>
                <MoreMenu label={t('more')} variant="secondary" items={wide ? tail : phoneItems} />
              </div>
            )}
          </HStack>
        )}
      </div>
    </header>
  );
}
