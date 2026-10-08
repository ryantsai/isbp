'use client';

import type { Me, NavItem, SessionResponse } from '@isbp/contracts';
import type { ShellHeaderSlotProps } from '@isbp/contracts';
import { createApiClient, PageContextProvider, PlatformProvider, Slot, SlotProvider } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Kbd } from '@isbp/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@isbp/ui/sheet';
import { MenuIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from '@isbp/ui/theme';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { passwordChangeHref } from '@/lib/password-change';
import { slotRegistry } from '@/lib/slots';
import { Brand } from './brand';
import { CommandPalette } from './command-palette';
import { BadgesProvider } from './live';
import { NotificationBell } from './notification-bell';
import { LocaleSwitcher, ThemeToggle } from './preferences';
import { Sidebar, SidebarNav } from './sidebar';
import { UserMenu } from './user-menu';

export function AppShell({
  session,
  nav,
  children,
}: {
  session: SessionResponse;
  nav: NavItem[];
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

  const savePrefs = (preferences: Me['preferences']) =>
    void api.patch('/me', { preferences }).catch(() => undefined);

  return (
    <PlatformProvider value={platform}>
      <SlotProvider value={slotRegistry}>
        <PageContextProvider path={pathname}>
          <BadgesProvider>
            <a
              href="#main"
              className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
            >
              {t('skipToContent')}
            </a>
            <div className="flex min-h-dvh">
              <Sidebar
                items={nav}
                collapsed={collapsed}
                onToggle={() => {
                  setCollapsed((c) => !c);
                  savePrefs({ sidebarCollapsed: !collapsed });
                }}
              />
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                  side="left"
                  className="w-72 gap-0 bg-sidebar p-0"
                  closeLabel={t('toggleSidebar')}
                >
                  <SheetTitle className="sr-only">{t('openNavigation')}</SheetTitle>
                  <Brand />
                  <SidebarNav items={nav} onNavigate={() => setMobileOpen(false)} layoutPrefix="mobile-nav" />
                </SheetContent>
              </Sheet>

              <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    onClick={() => setMobileOpen(true)}
                    aria-label={t('openNavigation')}
                  >
                    <MenuIcon />
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    className="group flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-lg border bg-card/60 px-3 text-sm text-muted-foreground shadow-xs transition-all hover:border-ring/40 hover:bg-card hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <SearchIcon className="size-4 transition-transform group-hover:scale-110" />
                    <span className="truncate">{t('searchPlaceholder')}</span>
                    <span className="ml-auto hidden items-center gap-0.5 sm:flex">
                      <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                      <Kbd>K</Kbd>
                    </span>
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    {/* Header actions of modules (the assistant): compact icon buttons, before the bell. */}
                    <Slot<ShellHeaderSlotProps> name="core.shell.header" props={{}} />
                    <NotificationBell />
                    <ThemeToggle onChange={(theme) => savePrefs({ theme })} />
                    <LocaleSwitcher csrfToken={session.csrfToken} />
                    <div className="ml-1">
                      <UserMenu />
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
