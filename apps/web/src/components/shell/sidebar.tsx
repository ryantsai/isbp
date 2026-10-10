'use client';

import type { NavItem } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Collapse, CollapseChevron, duration, ease, spring } from '@isbp/ui/motion';
import { Hint } from '@isbp/ui/tooltip';
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NavIcon } from '../nav-icon';
import { Brand } from './brand';
import { useBadges } from './live';

export function isActivePath(pathname: string, href: string) {
  const path = href.split(/[?#]/)[0]!;
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

/** How well a row matches the current path: the length of its best pattern (-1 = no match). */
function matchScore(pathname: string, item: NavItem): number {
  let best = -1;
  const consider = (href: string, prefix = false) => {
    const path = href.split(/[?#]/)[0]!;
    const hit = prefix ? pathname.startsWith(path) : isActivePath(pathname, path);
    if (hit && path.length > best) best = path.length;
  };
  consider(item.href);
  item.tabs?.forEach((t) => consider(t.href));
  item.match?.forEach((m) => consider(m, true));
  return best;
}

/**
 * The row to highlight — the most specific match among rows, their section tabs and `match` prefixes (Problems wins
 * over Tickets on `/itsm/tickets/PRB-00011`) — and the group it is in.
 */
export function activeNav(pathname: string, items: readonly NavItem[]) {
  let row: string | null = null;
  let group: string | null = null;
  let best = -1;
  for (const item of items) {
    for (const child of item.children ?? [item]) {
      const score = matchScore(pathname, child);
      if (score > best) {
        best = score;
        row = child.id;
        group = item.children ? item.id : null;
      }
    }
  }
  return { row, group };
}

/** The personal block (Home, My work, Requests…), the areas, and Administration: separated by a rule. */
const zoneOf = (item: NavItem) => (item.order < 10 ? 0 : item.order >= 1000 ? 2 : 1);

function useLabel() {
  const t = useTranslations();
  return (key: string) => (t.has(key) ? t(key) : key);
}

function CountBadge({ count, dot }: { count: number; dot?: boolean }) {
  const t = useTranslations('shell');
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span
          key="badge"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0, transition: { duration: duration.fast } }}
          transition={spring.indicator}
          className={cn(
            'relative grid place-items-center rounded-full bg-sidebar-primary font-semibold text-sidebar tabular-nums',
            dot
              ? 'absolute top-1 right-1.5 size-2 text-[0px]'
              : 'ml-auto h-[18px] min-w-[18px] px-1.5 text-[11px]',
          )}
        >
          {/* A new count "pops" once. */}
          <motion.span
            key={count}
            aria-hidden
            initial={{ scale: 1.25 }}
            animate={{ scale: 1 }}
            transition={{ duration: duration.base, ease: ease.enter }}
          >
            {count > 99 ? '99+' : count}
          </motion.span>
          <span className="sr-only">{t('badgeCount', { count })}</span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** The current page: a lighter navy row marked by the green square of the TEL logo. */
function ActivePill({ layoutPrefix }: { layoutPrefix: string }) {
  return (
    <>
      <motion.span
        layoutId={`${layoutPrefix}-pill`}
        transition={spring.indicator}
        className="absolute inset-0 rounded-sm bg-sidebar-accent"
      />
      <motion.span
        layoutId={`${layoutPrefix}-mark`}
        transition={spring.indicator}
        className="absolute top-[calc(50%-3px)] left-0 size-1.5 bg-brand-green"
      />
    </>
  );
}

const rowClass = (active: boolean, collapsed: boolean) =>
  cn(
    'group relative flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-primary motion-reduce:transition-none',
    active
      ? 'font-medium text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/80 hover:bg-white/6 hover:text-sidebar-accent-foreground',
    collapsed && 'justify-center px-0',
  );

function NavRow({
  item,
  active,
  collapsed,
  nested,
  onNavigate,
  layoutPrefix,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  nested?: boolean;
  onNavigate?: () => void;
  layoutPrefix: string;
}) {
  const label = useLabel()(item.label);
  const badges = useBadges();
  const count = item.badge ? (badges[item.badge as keyof typeof badges] ?? 0) : 0;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-nav-id={item.id}
      className={cn(rowClass(active, collapsed), nested && 'h-7')}
    >
      {active && <ActivePill layoutPrefix={layoutPrefix} />}
      <NavIcon
        name={item.icon}
        className={cn(
          'relative shrink-0 transition-transform duration-(--motion-base) group-hover:scale-110 motion-reduce:transition-none',
          nested ? 'size-3.5' : 'size-4',
          active && 'text-sidebar-primary',
        )}
      />
      {!collapsed && <span className="relative min-w-0 flex-1 truncate">{label}</span>}
      <CountBadge count={count} dot={collapsed} />
    </Link>
  );
  return collapsed ? (
    <Hint label={label} side="right">
      {link}
    </Hint>
  ) : (
    link
  );
}

/** A collapsible area (Service desk ▸ Tickets, Problems…). In the collapsed rail: an icon with a flyout menu. */
function NavGroup({
  item,
  activeRow,
  isCurrent,
  open,
  onToggle,
  collapsed,
  onNavigate,
  layoutPrefix,
}: {
  item: NavItem;
  activeRow: string | null;
  isCurrent: boolean;
  open: boolean;
  onToggle: () => void;
  collapsed: boolean;
  onNavigate?: () => void;
  layoutPrefix: string;
}) {
  const label = useLabel();
  const badges = useBadges();
  const children = item.children ?? [];
  const count = children.reduce(
    (n, c) => n + (c.badge ? (badges[c.badge as keyof typeof badges] ?? 0) : 0),
    0,
  );
  const panelId = `${layoutPrefix}-${item.id.replace(/\W/g, '-')}`;

  if (collapsed)
    return (
      <DropdownMenu>
        <Hint label={label(item.label)} side="right">
          <DropdownMenuTrigger
            className={rowClass(isCurrent, true)}
            aria-label={label(item.label)}
            data-nav-id={item.id}
          >
            {isCurrent && <ActivePill layoutPrefix={layoutPrefix} />}
            <NavIcon
              name={item.icon}
              className={cn('relative size-4', isCurrent && 'text-sidebar-primary')}
            />
            <CountBadge count={count} dot />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
          <DropdownMenuLabel>{label(item.label)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {children.map((c) => (
            <DropdownMenuItem key={c.id} asChild>
              <Link href={c.href} aria-current={c.id === activeRow ? 'page' : undefined}>
                <NavIcon name={c.icon} className={cn('size-4', c.id === activeRow && 'text-primary')} />
                <span className={cn('truncate', c.id === activeRow && 'font-medium')}>{label(c.label)}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-nav-id={item.id}
        className={rowClass(isCurrent && !open, false)}
      >
        {isCurrent && !open && <ActivePill layoutPrefix={layoutPrefix} />}
        <NavIcon
          name={item.icon}
          className={cn(
            'relative size-4 shrink-0 transition-transform duration-(--motion-base) group-hover:scale-110 motion-reduce:transition-none',
            isCurrent && 'text-sidebar-primary',
          )}
        />
        <span className={cn('relative min-w-0 flex-1 truncate', isCurrent && 'font-medium')}>
          {label(item.label)}
        </span>
        {!open && <CountBadge count={count} />}
        <CollapseChevron open={open} className="relative" />
      </button>
      <Collapse open={open} id={panelId}>
        <ul className="mt-px ml-[17px] flex flex-col gap-px border-l border-sidebar-border pl-2">
          {children.map((c) => (
            <li key={c.id}>
              <NavRow
                item={c}
                active={c.id === activeRow}
                collapsed={false}
                nested
                onNavigate={onNavigate}
                layoutPrefix={layoutPrefix}
              />
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}

export interface NavExpansion {
  /** Groups the person opened (remembered in their preferences). */
  expanded: readonly string[];
  /** The current group the person closed (it stays closed until they go to another area). */
  dismissed: string | null;
  onToggle: (groupId: string, currentGroup: string | null, open: boolean) => void;
}

export function isGroupOpen(nav: NavExpansion, id: string, current: string | null) {
  return nav.expanded.includes(id) || (id === current && nav.dismissed !== id);
}

export function SidebarNav({
  items,
  expansion,
  collapsed = false,
  onNavigate,
  layoutPrefix = 'nav',
}: {
  items: NavItem[];
  expansion: NavExpansion;
  collapsed?: boolean;
  onNavigate?: () => void;
  layoutPrefix?: string;
}) {
  const t = useTranslations('core.nav');
  const pathname = usePathname();
  const { row, group } = activeNav(pathname, items);
  return (
    <LayoutGroup id={layoutPrefix}>
      <nav aria-label={t('main')} className="px-2 py-1.5">
        <ul className="flex flex-col gap-px">
          {items.map((item, i) => {
            const divider = i > 0 && zoneOf(item) !== zoneOf(items[i - 1]!);
            const open = isGroupOpen(expansion, item.id, group);
            return (
              <li key={item.id} className="flex flex-col">
                {divider && <div aria-hidden className="mx-2 my-1.5 h-px bg-sidebar-border" />}
                {item.children ? (
                  <NavGroup
                    item={item}
                    activeRow={row}
                    isCurrent={group === item.id}
                    open={open}
                    onToggle={() => expansion.onToggle(item.id, group, !open)}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    layoutPrefix={layoutPrefix}
                  />
                ) : (
                  <NavRow
                    item={item}
                    active={item.id === row}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    layoutPrefix={layoutPrefix}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </LayoutGroup>
  );
}

export function Sidebar({
  items,
  expansion,
  collapsed,
  onToggle,
}: {
  items: NavItem[];
  expansion: NavExpansion;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('shell');
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 232 }}
      transition={{ duration: 0.2, ease: ease.move }}
      className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground lg:flex"
    >
      <Brand collapsed={collapsed} />
      <div className="flex-1 overflow-x-hidden overflow-y-auto [scrollbar-color:oklch(1_0_0/18%)_transparent] [scrollbar-width:thin]">
        <SidebarNav items={items} expansion={expansion} collapsed={collapsed} />
      </div>
      <div
        className={cn(
          'flex border-t border-sidebar-border p-2',
          collapsed ? 'justify-center' : 'justify-end',
        )}
      >
        <Hint label={t('toggleSidebar')} side="right">
          <button
            type="button"
            onClick={onToggle}
            aria-label={t('toggleSidebar')}
            aria-expanded={!collapsed}
            className="grid size-8 place-items-center rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:outline-none"
          >
            {collapsed ? <PanelLeftOpenIcon className="size-4" /> : <PanelLeftCloseIcon className="size-4" />}
          </button>
        </Hint>
      </div>
    </motion.aside>
  );
}
