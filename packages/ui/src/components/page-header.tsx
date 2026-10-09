'use client';

import { ArrowLeftIcon, EllipsisIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';
import { pathOf, recallListHref, rememberOpenedRow } from '../lib/list-memory';
import { cn } from '../lib/utils';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

const noopSubscribe = () => () => {};

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
      onClick={() => {
        if (highlight) rememberOpenedRow(pathOf(href), highlight);
      }}
      className={cn(
        '-ml-1 inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      <ArrowLeftIcon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
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
    <div className={cn('flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        {back && <BackLink href={back.href} label={back.label} className="mb-1" />}
        {eyebrow && <div className="text-sm text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight wrap-break-word">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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

/**
 * Detail pages: back link → reference · type → title (wraps, never truncated) → status and badges → one meta line,
 * with the actions top-right: `primaryAction` (the next step; always visible), up to 2 `actions` as outline
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
  return (
    <header className={cn('space-y-3 pb-6', className)}>
      {back && <BackLink href={back.href} label={back.label} highlight={back.highlight} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
              {icon}
            </div>
          )}
          <div className="min-w-0 space-y-1.5">
            {reference && <div className="text-sm text-muted-foreground wrap-break-word">{reference}</div>}
            <h1 className="text-2xl leading-tight font-semibold tracking-tight wrap-break-word">{title}</h1>
            {(status || badges) && (
              <div className="flex flex-wrap items-center gap-2">
                {status}
                {badges}
              </div>
            )}
            {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
          </div>
        </div>
        {(primaryAction || children || visible.length > 0 || hasMenu) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {children}
            {visible.map((a) => (
              <ActionButton key={a.id ?? a.label} action={a} className="hidden sm:inline-flex" />
            ))}
            {primaryAction}
            {(hasMenu || visible.length > 0) && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t('more')}
                    className={cn(!hasMenu && 'sm:hidden')}
                  >
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {visible.map((a) => (
                    <ActionItem key={a.id ?? a.label} action={a} className="sm:hidden" />
                  ))}
                  {plain.map((a) => (
                    <ActionItem key={a.id ?? a.label} action={a} />
                  ))}
                  {destructive.length > 0 && (plain.length > 0 || visible.length > 0) && (
                    <DropdownMenuSeparator className={cn(plain.length === 0 && 'sm:hidden')} />
                  )}
                  {destructive.map((a) => (
                    <ActionItem key={a.id ?? a.label} action={a} />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function ActionButton({ action, className }: { action: DetailAction; className?: string }) {
  if (action.href && !action.disabled)
    return (
      <Button variant="outline" asChild className={className}>
        <Link href={action.href}>
          {action.icon}
          {action.label}
        </Link>
      </Button>
    );
  return (
    <Button variant="outline" onClick={action.onSelect} disabled={action.disabled} className={className}>
      {action.icon}
      {action.label}
    </Button>
  );
}

function ActionItem({ action, className }: { action: DetailAction; className?: string }) {
  const variant = action.destructive ? 'destructive' : 'default';
  if (action.href && !action.disabled)
    return (
      <DropdownMenuItem asChild variant={variant} className={className}>
        <Link href={action.href}>
          {action.icon}
          {action.label}
        </Link>
      </DropdownMenuItem>
    );
  return (
    <DropdownMenuItem
      variant={variant}
      disabled={action.disabled}
      onSelect={action.onSelect}
      className={className}
    >
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
}
