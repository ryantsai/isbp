'use client';

import type { NavItem } from '@isbp/contracts';
import { Hint } from '@isbp/ui/tooltip';
import { cn } from '@isbp/ui';
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NavIcon } from '../nav-icon';
import { Brand } from './brand';

const spring = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const;

export function isActivePath(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  collapsed,
  onNavigate,
  layoutPrefix,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  layoutPrefix: string;
}) {
  const pathname = usePathname();
  const t = useTranslations();
  const active = isActivePath(pathname, item.href);
  const label = t.has(item.label) ? t(item.label) : item.label;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <>
          <motion.span
            layoutId={`${layoutPrefix}-pill`}
            transition={spring}
            className="absolute inset-0 rounded-md bg-sidebar-accent shadow-xs ring-1 ring-sidebar-border"
          />
          <motion.span
            layoutId={`${layoutPrefix}-bar`}
            transition={spring}
            className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-primary"
          />
        </>
      )}
      <NavIcon
        name={item.icon}
        className={cn(
          'relative size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110',
          active && 'text-primary',
        )}
      />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            className="relative truncate"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
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

export function SidebarNav({
  items,
  collapsed = false,
  onNavigate,
  layoutPrefix = 'nav',
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
  layoutPrefix?: string;
}) {
  const t = useTranslations('core.nav');
  const sections = [
    { key: 'main' as const, label: t('sectionMain') },
    { key: 'admin' as const, label: t('sectionAdmin') },
  ];
  return (
    <LayoutGroup id={layoutPrefix}>
      <nav aria-label={t('sectionMain')} className="flex flex-col gap-5 px-3 py-2">
        {sections.map((section) => {
          const sectionItems = items.filter((i) => i.section === section.key);
          if (!sectionItems.length) return null;
          return (
            <div key={section.key} className="flex flex-col gap-0.5">
              <div
                className={cn(
                  'mb-1 h-5 px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-opacity',
                  collapsed && 'opacity-0',
                )}
              >
                {section.label}
              </div>
              {sectionItems.map((item) => (
                <NavLink
                  key={item.id}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  layoutPrefix={layoutPrefix}
                />
              ))}
            </div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

export function Sidebar({
  items,
  collapsed,
  onToggle,
}: {
  items: NavItem[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('shell');
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 68 : 252 }}
      transition={spring}
      className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
    >
      <Brand collapsed={collapsed} />
      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        <SidebarNav items={items} collapsed={collapsed} />
      </div>
      <div
        className={cn(
          'flex border-t border-sidebar-border p-3',
          collapsed ? 'justify-center' : 'justify-end',
        )}
      >
        <Hint label={t('toggleSidebar')} side="right">
          <button
            type="button"
            onClick={onToggle}
            aria-label={t('toggleSidebar')}
            aria-expanded={!collapsed}
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {collapsed ? <PanelLeftOpenIcon className="size-4" /> : <PanelLeftCloseIcon className="size-4" />}
          </button>
        </Hint>
      </div>
    </motion.aside>
  );
}
