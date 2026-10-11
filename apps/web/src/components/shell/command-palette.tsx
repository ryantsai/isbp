'use client';

import {
  CommandPalette as AstryxCommandPalette,
  CommandPaletteInput,
} from '@astryxdesign/core/CommandPalette';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead';
import type { Navigation, NavItem, SearchHitDTO } from '@isbp/contracts';
import { localeLabels, locales } from '@isbp/i18n';
import { createApiClient, useCan, usePlatform } from '@isbp/sdk/web';
import { useTheme } from '@isbp/ui/theme';
import {
  BookOpenIcon,
  LanguagesIcon,
  LogOutIcon,
  MessageCircleQuestionIcon,
  MoonIcon,
  SearchIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { navIcon } from '../nav-icon';
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
const DEBOUNCE_MS = 180;

/** What a row does and how it looks. `group` is the heading Astryx files the row under. */
interface Meta {
  group: string;
  icon: IconType;
  /** Where Enter goes, or what it runs. */
  href?: string;
  run?: () => void;
  subtitle?: string | null;
  /** The area a page is in ("Assets › Vendors"). */
  context?: string | null;
  status?: string | null;
}
type Item = SearchableItem<Meta>;

/** A page the palette can open: its label, the area it is in, and words to match. */
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

/**
 * ⌘K / Ctrl K: jump to a page, find a record, or run a command. Astryx `CommandPalette` supplies the dialog, the
 * keyboard model and the footer; the content is one search source: suggestions and top pages when nothing is typed;
 * then (from 2 characters) matching records from the platform search grouped by type, matching pages, matching
 * commands, and "search the knowledge base / ask IT" fallbacks.
 */
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
  const destinations = useDestinations(nav);
  const api = useMemo(() => createApiClient(csrfToken), [csrfToken]);

  const go = (href: string) => {
    onOpenChange(false);
    markNavigating();
    router.push(href);
  };

  // The source and the selection handler read the latest props through a ref, so the source object is stable.
  const latest = useRef<{ items: Map<string, Item> }>({ items: new Map() });
  const ctx = {
    t,
    tc,
    destinations,
    canCreateUser,
    canDocs,
    canKnowledge,
    canAskIt,
    canReport,
    resolvedTheme,
    setTheme,
    change,
    signOut,
    api,
    go,
  };
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  const source = useMemo<SearchSource<Item>>(() => {
    let seq = 0;
    const label = (key: string) => (ctxRef.current.t.has(key) ? ctxRef.current.t(key) : key);
    // Astryx starts with nothing highlighted, so "type, Enter" would do nothing. Once the rows have rendered, move the
    // highlight to the first one (a single ArrowDown) unless the person has already moved it: the combobox input
    // reports the highlighted row in `aria-activedescendant`.
    const highlightFirst = () => {
      const input = document.querySelector<HTMLInputElement>(
        'dialog[open] input[role="combobox"], [role="dialog"] input[role="combobox"]',
      );
      if (input && !input.getAttribute('aria-activedescendant')) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        );
      }
    };
    const remember = (items: Item[]) => {
      latest.current.items = new Map(items.map((i) => [i.id, i]));
      if (items.length) setTimeout(highlightFirst, 80);
      return items;
    };

    const suggested = (): Item[] => {
      const c = ctxRef.current;
      const g = c.tc('suggested');
      const rows: Item[] = [
        {
          id: 'suggested:my-work',
          label: label('core.nav.myWork'),
          auxiliaryData: { group: g, icon: navIcon('inbox'), href: '/my-work' },
        },
        {
          id: 'suggested:request',
          label: c.tc('newRequest'),
          auxiliaryData: { group: g, icon: navIcon('clipboard-list'), href: '/requests' },
        },
      ];
      if (c.canReport)
        rows.push({
          id: 'suggested:report',
          label: c.tc('reportProblem'),
          auxiliaryData: { group: g, icon: navIcon('life-buoy'), href: '/itsm/report' },
        });
      if (c.canAskIt)
        rows.push({
          id: 'suggested:ask',
          label: c.tc('askIt'),
          auxiliaryData: { group: g, icon: MessageCircleQuestionIcon, href: '/helpdesk-ai/chat' },
        });
      return rows;
    };

    const navRows = (needle: string): Item[] => {
      const c = ctxRef.current;
      const g = c.tc('navigate');
      const matches = needle
        ? c.destinations
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
        : c.destinations.filter((d) => d.top);
      return matches.map((d) => ({
        id: `nav:${d.id}`,
        label: d.label,
        auxiliaryData: { group: g, icon: navIcon(d.icon), href: d.href, context: d.context },
      }));
    };

    const actionRows = (needle: string): Item[] => {
      const c = ctxRef.current;
      const g = c.tc('actions');
      const all: { id: string; label: string; icon: IconType; run: () => void }[] = [
        ...(c.canCreateUser
          ? [
              {
                id: 'create-user',
                label: c.tc('createUser'),
                icon: UserPlusIcon,
                run: () => c.go('/admin/users?create=1'),
              },
            ]
          : []),
        {
          id: 'theme',
          label: c.tc('toggleTheme'),
          icon: MoonIcon,
          run: () => c.setTheme(c.resolvedTheme === 'dark' ? 'light' : 'dark'),
        },
        ...locales.map((l) => ({
          id: `lang-${l}`,
          label: `${c.tc('changeLanguage')}: ${localeLabels[l]}`,
          icon: LanguagesIcon,
          run: () => c.change(l),
        })),
        ...(c.canDocs
          ? [
              {
                id: 'docs',
                label: c.tc('openApiDocs'),
                icon: BookOpenIcon,
                run: () => window.open('/api/docs', '_blank', 'noopener'),
              },
            ]
          : []),
        { id: 'signout', label: c.tc('signOut'), icon: LogOutIcon, run: () => void c.signOut() },
      ];
      return all
        .filter((a) => a.label.toLowerCase().includes(needle))
        .map((a) => ({
          id: `action:${a.id}`,
          label: a.label,
          auxiliaryData: { group: g, icon: a.icon, run: a.run },
        }));
    };

    return {
      bootstrap: () => remember([...suggested(), ...navRows('')]),
      cancel: () => {
        seq++;
      },
      search: async (query: string) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return remember([...suggested(), ...navRows('')]);
        const c = ctxRef.current;
        let groups: [string, SearchHitDTO[]][] = [];
        if (needle.length >= 2) {
          const mine = ++seq;
          await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
          if (mine === seq) {
            try {
              const { hits } = await c.api.get<{ hits: SearchHitDTO[] }>('/platform/search', {
                q: query.trim(),
                limit: 5,
              });
              const byType = new Map<string, SearchHitDTO[]>();
              const seen = new Set<string>();
              for (const h of hits) {
                if (seen.has(h.href)) continue;
                seen.add(h.href);
                const list = byType.get(h.type) ?? [];
                if (list.length < PER_TYPE) list.push(h);
                byType.set(h.type, list);
              }
              const rank = (type: string) =>
                TYPE_ORDER.includes(type) ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length;
              groups = [...byType.entries()].sort(([a, ha], [b, hb]) => {
                const exact = Number(Boolean(hb[0]?.exact)) - Number(Boolean(ha[0]?.exact));
                return exact || rank(a) - rank(b);
              });
            } catch {
              /* offline or forbidden: pages and commands still work */
            }
          }
        }
        const typeHeading = (type: string) => {
          const key = `shell.commandPalette.types.${type}`;
          return c.t.has(key) ? c.t(key) : c.tc('results');
        };
        const hitRows: Item[] = groups.flatMap(([type, list]) =>
          list.map<Item>((h) => ({
            id: `hit:${h.type}:${h.id}`,
            label: h.title,
            auxiliaryData: {
              group: typeHeading(type),
              icon: navIcon(h.icon ?? TYPE_ICONS[h.type]),
              href: h.href,
              subtitle: h.subtitle,
              status: h.status && c.t.has(h.status) ? c.t(h.status) : null,
            },
          })),
        );
        const more: Item[] = [];
        if (needle.length >= 2 && (c.canKnowledge || c.canAskIt)) {
          const g = c.tc('more');
          if (c.canKnowledge)
            more.push({
              id: 'fallback:knowledge',
              label: c.tc('searchKnowledge', { q: query.trim() }),
              auxiliaryData: {
                group: g,
                icon: SearchIcon,
                href: `/knowledge?q=${encodeURIComponent(query.trim())}`,
              },
            });
          if (c.canAskIt)
            more.push({
              id: 'fallback:ask',
              label: c.tc('askItAbout', { q: query.trim() }),
              auxiliaryData: {
                group: g,
                icon: MessageCircleQuestionIcon,
                href: `/helpdesk-ai/chat?q=${encodeURIComponent(query.trim())}`,
              },
            });
        }
        return remember([...hitRows, ...navRows(needle), ...actionRows(needle), ...more]);
      },
    };
  }, []);

  return (
    <AstryxCommandPalette
      isOpen={open}
      onOpenChange={onOpenChange}
      searchSource={source}
      label={t('shell.searchPlaceholder')}
      input={<CommandPaletteInput placeholder={tc('placeholder')} />}
      emptySearchText={tc('empty')}
      emptyBootstrapText={tc('empty')}
      onValueChange={(id) => {
        const item = latest.current.items.get(id);
        const meta = item?.auxiliaryData;
        if (!meta) return;
        if (meta.href) go(meta.href);
        else if (meta.run) {
          onOpenChange(false);
          meta.run();
        }
      }}
      renderItem={(item) => {
        const meta = item.auxiliaryData as Meta;
        return (
          <HStack gap={3} vAlign="center">
            <Icon icon={meta.icon} size="sm" color="secondary" />
            <StackItem size="fill">
              <VStack gap={0}>
                <Text maxLines={1}>
                  {meta.context ? <Text color="secondary">{meta.context} › </Text> : null}
                  {item.label}
                </Text>
                {meta.subtitle ? (
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {meta.subtitle}
                  </Text>
                ) : null}
              </VStack>
            </StackItem>
            {meta.status ? (
              <Text type="supporting" color="secondary">
                {meta.status}
              </Text>
            ) : null}
          </HStack>
        );
      }}
    />
  );
}
