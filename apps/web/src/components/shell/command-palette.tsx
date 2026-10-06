'use client';

import type { NavItem, SearchHitDTO } from '@isbp/contracts';
import { localeLabels, locales } from '@isbp/i18n';
import { useCan } from '@isbp/sdk/web';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@isbp/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@isbp/ui/dialog';
import { Kbd } from '@isbp/ui/kbd';
import { Spinner } from '@isbp/ui/spinner';
import {
  BookOpenIcon,
  CornerDownLeftIcon,
  LanguagesIcon,
  LogOutIcon,
  MoonIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from '@isbp/ui/theme';
import { useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { useChangeLocale } from './preferences';
import { useSignOut } from './use-sign-out';

const TYPE_ICONS: Record<string, string> = {
  user: 'user',
  group: 'users-round',
  role: 'shield-check',
  department: 'network',
};

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function CommandPalette({
  open,
  onOpenChange,
  nav,
  csrfToken,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nav: NavItem[];
  csrfToken: string;
}) {
  const t = useTranslations();
  const tc = useTranslations('shell.commandPalette');
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { change } = useChangeLocale(csrfToken);
  const signOut = useSignOut();
  const canCreateUser = useCan('core.users.create');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 180);
  const search = useApiQuery<{ hits: SearchHitDTO[] }>(q.length >= 2 ? '/platform/search' : null, {
    q,
    limit: 5,
  });

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const flatNav = useMemo(() => nav.flatMap((n) => [n, ...(n.children ?? [])]), [nav]);
  const label = (key: string) => (t.has(key) ? t(key) : key);
  const needle = query.trim().toLowerCase();
  const navMatches = flatNav.filter(
    (n) => !needle || label(n.label).toLowerCase().includes(needle) || n.href.includes(needle),
  );

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const actions = [
    canCreateUser && {
      id: 'create-user',
      label: tc('createUser'),
      icon: <UserPlusIcon />,
      run: () => router.push('/admin/users?create=1'),
    },
    {
      id: 'theme',
      label: tc('toggleTheme'),
      icon: <MoonIcon />,
      run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
    },
    ...locales.map((l) => ({
      id: `lang-${l}`,
      label: `${tc('changeLanguage')}: ${localeLabels[l]}`,
      icon: <LanguagesIcon />,
      run: () => change(l),
    })),
    {
      id: 'docs',
      label: tc('openApiDocs'),
      icon: <BookOpenIcon />,
      run: () => window.open('/api/docs', '_blank', 'noopener'),
    },
    { id: 'signout', label: tc('signOut'), icon: <LogOutIcon />, run: () => void signOut() },
  ].filter((a) => a !== false);
  const actionMatches = actions.filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const hits = q.length >= 2 ? (search.data?.hits ?? []) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t('shell.searchPlaceholder')}</DialogTitle>
        <DialogDescription className="sr-only">{tc('placeholder')}</DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={tc('placeholder')}
            trailing={search.isFetching ? <Spinner className="text-muted-foreground" /> : <Kbd>Esc</Kbd>}
          />
          <CommandList>
            <CommandEmpty>{search.isFetching ? tc('searching') : tc('empty')}</CommandEmpty>
            {hits.length > 0 && (
              <CommandGroup heading={tc('results')}>
                {hits.map((h) => (
                  <CommandItem
                    key={`${h.type}:${h.id}`}
                    value={`hit:${h.type}:${h.id}`}
                    onSelect={() => run(() => router.push(h.href))}
                  >
                    <NavIcon name={h.icon ?? TYPE_ICONS[h.type]} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{h.title}</span>
                      {h.subtitle && (
                        <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
                      )}
                    </div>
                    <CommandShortcut className="tracking-normal">{h.type}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {navMatches.length > 0 && (
              <CommandGroup heading={tc('navigate')}>
                {navMatches.map((n) => (
                  <CommandItem
                    key={n.id}
                    value={`nav:${n.id}`}
                    onSelect={() => run(() => router.push(n.href))}
                  >
                    <NavIcon name={n.icon} />
                    {label(n.label)}
                    <CommandShortcut>
                      <CornerDownLeftIcon className="size-3" />
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {actionMatches.length > 0 && (
              <CommandGroup heading={tc('actions')}>
                {actionMatches.map((a) => (
                  <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => run(a.run)}>
                    {a.icon}
                    {a.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
