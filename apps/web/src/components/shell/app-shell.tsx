'use client';

import type { Me, Navigation, SessionResponse, ShellHeaderSlotProps } from '@isbp/contracts';
import { createApiClient, PageContextProvider, PlatformProvider, Slot, SlotProvider } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Kbd } from '@isbp/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@isbp/ui/sheet';
import { useTheme } from '@isbp/ui/theme';
import { Hint } from '@isbp/ui/tooltip';
import { CircleHelpIcon, MenuIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { passwordChangeHref } from '@/lib/password-change';
import { slotRegistry } from '@/lib/slots';
import { Brand } from './brand';
import { CommandPalette } from './command-palette';
import { helpHrefFor, useCanHelp } from './help-link';
import { BadgesProvider, useBadges } from './live';
import { NotificationBell } from './notification-bell';
import { RouteProgress } from './route-progress';
import { activeNav, type NavExpansion, Sidebar, SidebarNav } from './sidebar';
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
    <Hint label={t('helpForPage')}>
      <Button asChild variant="ghost" size="icon" className="hidden sm:inline-flex">
        <Link href={helpHrefFor(pathname)} aria-label={t('helpForPage')}>
          <CircleHelpIcon />
        </Link>
      </Button>
    </Hint>
  );
}

/** The phone menu button carries a dot when something is waiting on My work (the rail itself is hidden). */
function MenuButton({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('shell');
  const work = useBadges().work;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative lg:hidden"
      onClick={onOpen}
      aria-label={work ? t('openNavigationWork', { count: work }) : t('openNavigation')}
    >
      <MenuIcon />
      {work > 0 && (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background"
        />
      )}
    </Button>
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
  const [isMac, setIsMac] = useState(true);
  const { setTheme } = useTheme();
  const api = useMemo(() => createApiClient(session.csrfToken), [session.csrfToken]);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);

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
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
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
  const current = activeNav(pathname, items);

  return (
    <PlatformProvider value={platform}>
      <SlotProvider value={slotRegistry}>
        <PageContextProvider path={pathname}>
          <BadgesProvider>
            <Suspense fallback={null}>
              <RouteProgress />
            </Suspense>
            <a
              href="#main"
              className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
            >
              {t('skipToContent')}
            </a>
            <div className="flex min-h-dvh">
              <Sidebar
                items={items}
                expansion={expansion}
                collapsed={collapsed}
                onToggle={() => {
                  setCollapsed((c) => !c);
                  savePrefs({ sidebarCollapsed: !collapsed });
                }}
              />
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                  side="left"
                  className="w-72 max-w-[85vw] gap-0 bg-sidebar p-0"
                  closeLabel={t('toggleSidebar')}
                  onOpenAutoFocus={(e) => {
                    // Start on the current page's entry rather than on the close button.
                    const target = drawerRef.current?.querySelector<HTMLElement>(
                      `[aria-current="page"], [data-nav-id="${current.group ?? ''}"]`,
                    );
                    if (target) {
                      e.preventDefault();
                      target.focus();
                    }
                  }}
                >
                  <SheetTitle className="sr-only">{t('openNavigation')}</SheetTitle>
                  <Brand />
                  {/* The drawer is fixed and full height: the list scrolls on its own, under a fixed brand. */}
                  <div ref={drawerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
                    <SidebarNav
                      items={items}
                      expansion={expansion}
                      onNavigate={() => setMobileOpen(false)}
                      layoutPrefix="mobile-nav"
                    />
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-background/80 px-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:gap-2 sm:px-5">
                  <MenuButton onOpen={() => setMobileOpen(true)} />
                  {/* Phones get an icon; wider screens the search box with its shortcut. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sm:hidden"
                    onClick={() => setPaletteOpen(true)}
                    aria-label={t('searchPlaceholder')}
                  >
                    <SearchIcon />
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    className="group hidden h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-lg border bg-card/60 px-3 text-sm text-muted-foreground shadow-xs transition-[border-color,background-color,box-shadow] duration-(--motion-fast) hover:border-ring/40 hover:bg-card hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none sm:flex"
                  >
                    <SearchIcon className="size-4" />
                    <span className="truncate">{t('searchPlaceholder')}</span>
                    <span className="ml-auto flex items-center gap-0.5">
                      <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                      <Kbd>K</Kbd>
                    </span>
                  </button>
                  <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
                    {/* Header actions of modules (the assistant): compact icon buttons, before help and the bell. */}
                    <Slot<ShellHeaderSlotProps> name="core.shell.header" props={{}} />
                    <HelpButton />
                    <NotificationBell />
                    <div className="ml-1">
                      <UserMenu
                        csrfToken={session.csrfToken}
                        onThemeChange={(theme) => savePrefs({ theme })}
                      />
                    </div>
                  </div>
                </header>
                {session.user.mustChangePassword &&
                  session.user.authSource === 'local' &&
                  pathname !== '/settings' && (
                    // Shown after client-side navigation away from the password card (full loads redirect there).
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground sm:px-6 lg:px-8">
                      <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0">{t('passwordRequired')}</span>
                      <Link
                        href={passwordChangeHref(pathname)}
                        className="font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {t('passwordRequiredAction')}
                      </Link>
                    </div>
                  )}
                <main
                  id="main"
                  tabIndex={-1}
                  className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
                >
                  {children}
                </main>
              </div>
            </div>
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
