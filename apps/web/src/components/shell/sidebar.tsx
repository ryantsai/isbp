'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { HStack } from '@astryxdesign/core/Layout';
import { MobileNav } from '@astryxdesign/core/MobileNav';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { Theme } from '@astryxdesign/core/theme';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import type { NavItem } from '@isbp/contracts';
import { telTheme } from '@isbp/ui/theme/tel';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { navIcon } from '../nav-icon';
import { BrandMark } from './brand';
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

/** A live count (My work, Approvals…): a badge, read aloud as "N waiting" rather than as a bare number. */
function Count({ count }: { count: number }) {
  const t = useTranslations('shell');
  if (count <= 0) return null;
  return (
    <>
      <Badge variant="info" label={count > 99 ? '99+' : String(count)} aria-hidden />
      <VisuallyHidden>{t('badgeCount', { count })}</VisuallyHidden>
    </>
  );
}

/** The rows of the navigation (shared by the desktop rail and the phone drawer): zones separated by a rule. */
function NavSections({
  items,
  expansion,
  onNavigate,
}: {
  items: NavItem[];
  expansion: NavExpansion;
  onNavigate?: () => void;
}) {
  const label = useLabel();
  const badges = useBadges();
  const pathname = usePathname();
  const { row, group } = activeNav(pathname, items);
  const countOf = (item: NavItem) => (item.badge ? (badges[item.badge as keyof typeof badges] ?? 0) : 0);

  const zones: NavItem[][] = [];
  for (const item of items) {
    const z = zoneOf(item);
    (zones[z] ??= []).push(item);
  }

  return (
    <>
      {zones.filter(Boolean).map((zone, zi) => (
        <SideNavSection key={zi} title={String(zi)} isHeaderHidden>
          {zone.map((item) => {
            if (!item.children) {
              return (
                <SideNavItem
                  key={item.id}
                  label={label(item.label)}
                  icon={navIcon(item.icon)}
                  href={item.href}
                  isSelected={item.id === row}
                  endContent={<Count count={countOf(item)} />}
                  onClick={onNavigate}
                />
              );
            }
            const open = isGroupOpen(expansion, item.id, group);
            const groupCount = item.children.reduce((n, c) => n + countOf(c), 0);
            return (
              <SideNavItem
                key={item.id}
                label={label(item.label)}
                icon={navIcon(item.icon)}
                isSelected={group === item.id && !open}
                endContent={!open ? <Count count={groupCount} /> : undefined}
                collapsible={{
                  isCollapsed: !open,
                  onCollapsedChange: (isCollapsed) => expansion.onToggle(item.id, group, !isCollapsed),
                }}
              >
                {item.children.map((c) => (
                  <SideNavItem
                    key={c.id}
                    label={label(c.label)}
                    icon={navIcon(c.icon)}
                    href={c.href}
                    isSelected={c.id === row}
                    endContent={<Count count={countOf(c)} />}
                    onClick={onNavigate}
                  />
                ))}
              </SideNavItem>
            );
          })}
        </SideNavSection>
      ))}
    </>
  );
}

/**
 * The navigation rail: Astryx `SideNav` fed by the navigation the API built from the module manifests. Sections are
 * the personal block, the areas (collapsible groups of 1–4 rows) and Administration; the green marker on the current row
 * comes from the TEL theme. `collapsed` is the person's saved choice (icon-only rail; groups open as flyouts).
 */
export function AppSideNav({
  items,
  expansion,
  collapsed,
  onCollapsedChange,
}: {
  items: NavItem[];
  expansion: NavExpansion;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const t = useTranslations('shell');
  const tn = useTranslations('core.nav');
  const tc = useTranslations('common');
  // The rail is navy in both colour modes: a nested dark Theme gives its text, hover and focus tokens.
  return (
    <Theme theme={telTheme} mode="dark">
      <SideNav
        aria-label={tn('main')}
        header={
          <SideNavHeading heading={tc('appName')} headingHref="/" icon={<BrandMark className="size-7" />} />
        }
        collapsible={{
          isCollapsed: collapsed,
          onCollapsedChange,
          hasButton: true,
          buttonLabel: t('toggleSidebar'),
        }}
      >
        <NavSections items={items} expansion={expansion} />
      </SideNav>
    </Theme>
  );
}

/** The phone drawer: the same rows in an Astryx `MobileNav`, never collapsed; choosing a page closes it. */
export function AppMobileNav({
  items,
  expansion,
  open,
  onOpenChange,
}: {
  items: NavItem[];
  expansion: NavExpansion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tc = useTranslations('common');
  return (
    <Theme theme={telTheme} mode="dark">
      <MobileNav
        isOpen={open}
        onOpenChange={onOpenChange}
        side="start"
        header={
          <HStack gap={2} vAlign="center">
            <BrandMark className="size-7" />
            <Text weight="semibold">{tc('appName')}</Text>
          </HStack>
        }
      >
        <NavSections items={items} expansion={expansion} onNavigate={() => onOpenChange(false)} />
      </MobileNav>
    </Theme>
  );
}
