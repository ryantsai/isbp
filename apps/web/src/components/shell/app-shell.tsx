'use client';

import { AppShell as AstryxAppShell } from '@astryxdesign/core/AppShell';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import type { Me, Navigation, SessionResponse, ShellHeaderSlotProps } from '@isbp/contracts';
import { createApiClient, PageContextProvider, PlatformProvider, Slot, SlotProvider } from '@isbp/sdk/web';
import { useTheme } from '@isbp/ui/theme';
import { CircleHelpIcon, MenuIcon, SearchIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, Suspense, useEffect, useMemo, useState } from 'react';
import { passwordChangeHref } from '@/lib/password-change';
import { slotRegistry } from '@/lib/slots';
import { CommandPalette } from './command-palette';
import { helpHrefFor, useCanHelp } from './help-link';
import { BadgesProvider, useBadges } from './live';
import { NotificationBell } from './notification-bell';
import { RouteProgress } from './route-progress';
import { AppMobileNav, AppSideNav, type NavExpansion } from './sidebar';
import { UserMenu } from './user-menu';

/** Open groups: the ones the person opened (saved to their profile), plus the current one unless they closed it. */
function useNavExpansion(initial: readonly string[] | undefined, save: (expanded: string[]) => void) {
  const [expanded, setExpanded] = useState<string[]>(() => [...(initial ?? [])]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  return useMemo<NavExpansion>(
    () => ({
      expanded,
      dismissed,
      onToggle: (id, current, open) => {
        const next = open ? [...new Set([...expanded, id])] : expanded.filter((x) => x !== id);
        setExpanded(next);
        if (!open && id === current) setDismissed(id);
        else if (open && dismissed === id) setDismissed(null);
        save(next);
      },
    }),
    [expanded, dismissed, save],
  );
}

function HelpButton() {
  const t = useTranslations('shell');
  const pathname = usePathname();
  if (!useCanHelp()) return null;
  return (
    <Button
      isIconOnly
      label={t('helpForPage')}
      tooltip={t('helpForPage')}
      variant="ghost"
      icon={<Icon icon={CircleHelpIcon} />}
      href={helpHrefFor(pathname)}
      className="hidden sm:inline-flex"
    />
  );
}

/** The phone menu button carries a dot when something is waiting on My work (the rail itself is hidden). */
function MenuButton({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('shell');
  const work = useBadges().work;
  return (
    <span className="relative inline-flex lg:hidden">
      <IconButton
        label={work ? t('openNavigationWork', { count: work }) : t('openNavigation')}
        variant="ghost"
        icon={<Icon icon={MenuIcon} />}
        onClick={onOpen}
      />
      {work > 0 && (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background"
        />
      )}
    </span>
  );
}

export function AppShell({
  session,
  nav,
  children,
}: {
  session: SessionResponse;
  nav: Navigation;
  children: ReactNode;
}) {
  const t = useTranslations('shell');
  const [collapsed, setCollapsed] = useState(Boolean(session.user.preferences.sidebarCollapsed));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { setTheme } = useTheme();
  const api = useMemo(() => createApiClient(session.csrfToken), [session.csrfToken]);
  const pathname = usePathname();

  const platform = useMemo(
    () => ({
      user: session.user,
      grants: session.grants,
      csrfToken: session.csrfToken,
      enabledModules: session.enabledModules,
    }),
    [session],
  );

  // The profile's theme follows the user to new devices; an explicit choice on this device wins.
  useEffect(() => {
    const pref = session.user.preferences.theme;
    let local: string | null = null;
    try {
      local = localStorage.getItem('theme');
    } catch {
      /* storage unavailable */
    }
    if (pref && !local) setTheme(pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const savePrefs = useMemo(
    () => (preferences: Me['preferences']) => void api.patch('/me', { preferences }).catch(() => undefined),
    [api],
  );
  const saveExpanded = useMemo(() => (navExpanded: string[]) => savePrefs({ navExpanded }), [savePrefs]);
  const expansion = useNavExpansion(session.user.preferences.navExpanded, saveExpanded);
  const items = nav.items;

  return (
    <PlatformProvider value={platform}>
      <SlotProvider value={slotRegistry}>
        <PageContextProvider path={pathname}>
          <BadgesProvider>
            <Suspense fallback={null}>
              <RouteProgress />
            </Suspense>
            <AstryxAppShell
              variant="wash"
              height="auto"
              contentPadding={0}
              sideNav={
                <AppSideNav
                  items={items}
                  expansion={expansion}
                  collapsed={collapsed}
                  onCollapsedChange={(next) => {
                    setCollapsed(next);
                    savePrefs({ sidebarCollapsed: next });
                  }}
                />
              }
              // Below `lg` the rail becomes a drawer opened by the header's menu button; it is never collapsed.
              mobileNav={{
                hasToggle: false,
                isOpen: mobileOpen,
                onOpenChange: setMobileOpen,
                breakpoint: 'lg',
                content: (
                  <AppMobileNav
                    items={items}
                    expansion={expansion}
                    open={mobileOpen}
                    onOpenChange={setMobileOpen}
                  />
                ),
              }}
            >
              <header
                role="banner"
                className="sticky top-0 z-30 flex h-12 items-center gap-1 border-b bg-card/90 px-2 backdrop-blur-md supports-[backdrop-filter]:bg-card/80 sm:gap-2 sm:px-4"
              >
                <MenuButton onOpen={() => setMobileOpen(true)} />
                {/* Phones get an icon; wider screens the search box with its shortcut. */}
                <IconButton
                  label={t('searchPlaceholder')}
                  variant="ghost"
                  icon={<Icon icon={SearchIcon} />}
                  onClick={() => setPaletteOpen(true)}
                  className="sm:hidden"
                />
                <div className="hidden min-w-0 max-w-md flex-1 items-center gap-2 sm:flex">
                  <Button
                    label={t('searchPlaceholder')}
                    variant="secondary"
                    icon={<Icon icon={SearchIcon} />}
                    onClick={() => setPaletteOpen(true)}
                    width="100%"
                  />
                  <Kbd keys="mod+k" />
                </div>
                <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
                  {/* Header actions of modules (the assistant): compact icon buttons, before help and the bell. */}
                  <Slot<ShellHeaderSlotProps> name="core.shell.header" props={{}} />
                  <HelpButton />
                  <NotificationBell />
                  <div className="ml-1">
                    <UserMenu csrfToken={session.csrfToken} onThemeChange={(theme) => savePrefs({ theme })} />
                  </div>
                </div>
              </header>
              {session.user.mustChangePassword &&
                session.user.authSource === 'local' &&
                pathname !== '/settings' && (
                  // Shown after client-side navigation away from the password card (full loads redirect there).
                  <Banner
                    status="warning"
                    container="section"
                    collapsible={false}
                    title={t('passwordRequired')}
                    endContent={
                      <Button
                        label={t('passwordRequiredAction')}
                        variant="secondary"
                        size="sm"
                        href={passwordChangeHref(pathname)}
                      />
                    }
                  />
                )}
              <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
                {children}
              </div>
            </AstryxAppShell>
            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              nav={nav}
              csrfToken={session.csrfToken}
            />
          </BadgesProvider>
        </PageContextProvider>
      </SlotProvider>
    </PlatformProvider>
  );
}
