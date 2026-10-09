'use client';

import type { Navigation, NavItem, SearchHitDTO } from '@isbp/contracts';
import { localeLabels, locales } from '@isbp/i18n';
import { useCan, usePlatform } from '@isbp/sdk/web';
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
import { useTheme } from '@isbp/ui/theme';
import {
  BookOpenIcon,
  CornerDownLeftIcon,
  LanguagesIcon,
  LogOutIcon,
  MessageCircleQuestionIcon,
  MoonIcon,
  SearchIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { useChangeLocale } from './preferences';
import { markNavigating } from './route-progress';
import { useSignOut } from './use-sign-out';

const TYPE_ICONS: Record<string, string> = {
  user: 'user',
  group: 'users-round',
  role: 'shield-check',
  department: 'network',
  request: 'clipboard-list',
};

/** Result groups in this order; unknown types follow. */
const TYPE_ORDER = [
  'request',
  'ticket',
  'article',
  'announcement',
  'asset',
  'license',
  'contract',
  'ci',
  'application',
  'release',
  'project',
  'task',
  'account',
  'endpoint',
  'pipeline',
  'job',
  'change-set',
  'user',
  'group',
  'role',
  'department',
];
const PER_TYPE = 4;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** A page the palette can open: its label, the area it is in ("Assets › Vendors"), and words to match. */
interface Destination {
  id: string;
  href: string;
  icon?: string;
  label: string;
  context: string | null;
  words: string;
  /** Top-level rows show when nothing is typed. */
  top: boolean;
}

function useDestinations(nav: Navigation): Destination[] {
  const t = useTranslations();
  return useMemo(() => {
    const label = (key?: string) => (key ? (t.has(key) ? t(key) : key) : '');
    const out: Destination[] = [];
    const seen = new Set<string>();
    const add = (item: NavItem, context: string | null, top: boolean) => {
      if (seen.has(item.href)) return;
      seen.add(item.href);
      const name = label(item.label);
      out.push({
        id: item.id,
        href: item.href,
        icon: item.icon,
        label: name,
        context: context && context !== name ? context : null,
        words: [name, context, label(item.keywords), label(item.description)].join(' ').toLowerCase(),
        top,
      });
      for (const tab of item.tabs ?? []) add(tab, context ?? name, false);
    };
    for (const item of nav.items) {
      if (item.children) {
        // The group itself isn't a page: its rows are, named with the group ("Service desk › Problems").
        const group = label(item.label);
        item.children.forEach((c, i) => add(c, group, i === 0));
      } else add(item, null, true);
    }
    const admin = label('core.nav.admin');
    for (const a of nav.admin) add(a, admin, false);
    return out;
  }, [nav, t]);
}

export function CommandPalette({
  open,
  onOpenChange,
  nav,
  csrfToken,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nav: Navigation;
  csrfToken: string;
}) {
  const t = useTranslations();
  const tc = useTranslations('shell.commandPalette');
  const router = useRouter();
  const { enabledModules, permissions } = usePlatform();
  const { resolvedTheme, setTheme } = useTheme();
  const { change } = useChangeLocale(csrfToken);
  const signOut = useSignOut();
  const canCreateUser = useCan('core.users.create');
  const canDocs = permissions.hasAny('core.api-clients.manage');
  const canKnowledge = enabledModules.includes('knowledge') && permissions.hasAny('knowledge.articles.read');
  const canAskIt = enabledModules.includes('helpdesk-ai') && permissions.hasAny('helpdesk-ai.chat.use');
  const canReport = enabledModules.includes('itsm') && permissions.hasAny('itsm.tickets.create');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 180);
  const search = useApiQuery<{ hits: SearchHitDTO[] }>(q.length >= 2 ? '/platform/search' : null, {
    q,
    limit: 5,
  });
  const destinations = useDestinations(nav);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const label = (key: string) => (t.has(key) ? t(key) : key);
  const needle = query.trim().toLowerCase();
  const navMatches = needle
    ? destinations
        .map((d) => ({
          d,
          score: d.label.toLowerCase().startsWith(needle)
            ? 0
            : d.label.toLowerCase().includes(needle)
              ? 1
              : d.words.includes(needle) || d.href.includes(needle)
                ? 2
                : 9,
        }))
        .filter((x) => x.score < 9)
        .sort((a, b) => a.score - b.score)
        .slice(0, 8)
        .map((x) => x.d)
    : destinations.filter((d) => d.top);

  const go = (href: string) => {
    onOpenChange(false);
    markNavigating();
    router.push(href);
  };
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const suggested: { id: string; label: string; icon: ReactNode; href: string }[] = [
    { id: 'my-work', label: label('core.nav.myWork'), icon: <NavIcon name="inbox" />, href: '/my-work' },
    { id: 'request', label: tc('newRequest'), icon: <NavIcon name="clipboard-list" />, href: '/requests' },
    ...(canReport
      ? [
          {
            id: 'report',
            label: tc('reportProblem'),
            icon: <NavIcon name="life-buoy" />,
            href: '/itsm/report',
          },
        ]
      : []),
    ...(canAskIt
      ? [{ id: 'ask', label: tc('askIt'), icon: <MessageCircleQuestionIcon />, href: '/helpdesk-ai/chat' }]
      : []),
  ];

  const actions = [
    canCreateUser && {
      id: 'create-user',
      label: tc('createUser'),
      icon: <UserPlusIcon />,
      run: () => go('/admin/users?create=1'),
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
    canDocs && {
      id: 'docs',
      label: tc('openApiDocs'),
      icon: <BookOpenIcon />,
      run: () => window.open('/api/docs', '_blank', 'noopener'),
    },
    { id: 'signout', label: tc('signOut'), icon: <LogOutIcon />, run: () => void signOut() },
  ].filter((a) => a !== false);
  const actionMatches = needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : [];

  // Group results by type (translated headings), the first few of each; one row per page.
  const data = q.length >= 2 ? search.data : undefined;
  const groups = useMemo(() => {
    const hits = data?.hits ?? [];
    const byType = new Map<string, SearchHitDTO[]>();
    const seen = new Set<string>();
    for (const h of hits) {
      if (seen.has(h.href)) continue;
      seen.add(h.href);
      const list = byType.get(h.type) ?? [];
      if (list.length < PER_TYPE) list.push(h);
      byType.set(h.type, list);
    }
    const rank = (type: string) => (TYPE_ORDER.includes(type) ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length);
    return [...byType.entries()].sort(([a, ha], [b, hb]) => {
      const exact = Number(Boolean(hb[0]?.exact)) - Number(Boolean(ha[0]?.exact));
      return exact || rank(a) - rank(b);
    });
  }, [data]);
  const typeHeading = (type: string) => {
    const key = `shell.commandPalette.types.${type}`;
    return t.has(key) ? t(key) : tc('results');
  };
  const searching = q.length >= 2 && search.isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[18%] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t('shell.searchPlaceholder')}</DialogTitle>
        <DialogDescription className="sr-only">{tc('placeholder')}</DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={tc('placeholder')}
            trailing={searching ? <Spinner className="text-muted-foreground" /> : <Kbd>Esc</Kbd>}
          />
          <CommandList>
            <CommandEmpty>{searching ? tc('searching') : tc('empty')}</CommandEmpty>
            {!needle && (
              <CommandGroup heading={tc('suggested')}>
                {suggested.map((s) => (
                  <CommandItem key={s.id} value={`suggested:${s.id}`} onSelect={() => go(s.href)}>
                    {s.icon}
                    {s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {groups.map(([type, list]) => (
              <CommandGroup key={type} heading={typeHeading(type)}>
                {list.map((h) => (
                  <CommandItem
                    key={`${h.type}:${h.id}`}
                    value={`hit:${h.type}:${h.id}`}
                    onSelect={() => go(h.href)}
                  >
                    <NavIcon name={h.icon ?? TYPE_ICONS[h.type]} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{h.title}</span>
                      {h.subtitle && (
                        <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
                      )}
                    </div>
                    {h.status && t.has(h.status) && (
                      <CommandShortcut className="shrink-0 tracking-normal">{t(h.status)}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {navMatches.length > 0 && (
              <CommandGroup heading={tc('navigate')}>
                {navMatches.map((d) => (
                  <CommandItem key={d.id} value={`nav:${d.id}`} onSelect={() => go(d.href)}>
                    <NavIcon name={d.icon} />
                    <span className="min-w-0 flex-1 truncate">
                      {d.context && <span className="text-muted-foreground">{d.context} › </span>}
                      {d.label}
                    </span>
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
            {/* Questions in plain words ("set up MFA") are answered by the knowledge base and Ask IT. */}
            {q.length >= 2 && (canKnowledge || canAskIt) && (
              <CommandGroup heading={tc('more')}>
                {canKnowledge && (
                  <CommandItem
                    value="fallback:knowledge"
                    onSelect={() => go(`/knowledge?q=${encodeURIComponent(q)}`)}
                  >
                    <SearchIcon />
                    <span className="min-w-0 flex-1 truncate">{tc('searchKnowledge', { q })}</span>
                  </CommandItem>
                )}
                {canAskIt && (
                  <CommandItem
                    value="fallback:ask"
                    onSelect={() => go(`/helpdesk-ai/chat?q=${encodeURIComponent(q)}`)}
                  >
                    <MessageCircleQuestionIcon />
                    <span className="min-w-0 flex-1 truncate">{tc('askItAbout', { q })}</span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
