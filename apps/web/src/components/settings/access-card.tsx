'use client';

import type { EffectivePermissions } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Skeleton } from '@isbp/ui/skeleton';
import { ChevronDownIcon, ShieldCheckIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useApiQuery } from '@/lib/api';

interface RoleRow {
  id: string;
  name: string;
  vias: string[];
  scopes: string[];
  expiresAt: string | null;
  permissions: string[];
}

/** Compact "what can I do and why" from `GET /me/permissions`, one row per role. */
export function AccessCard() {
  const t = useTranslations('settings.access');
  const tc = useTranslations('common');
  const tr = useTranslations('core.systemRoles');
  const format = useFormatter();
  const { data, isLoading } = useApiQuery<EffectivePermissions>('/me/permissions');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo<RoleRow[]>(() => {
    const byRole = new Map<
      string,
      RoleRow & { viaSet: Set<string>; scopeSet: Set<string>; permSet: Set<string> }
    >();
    for (const s of data?.sources ?? []) {
      const row =
        byRole.get(s.role.id) ??
        ({
          id: s.role.id,
          name: tr.has(`${s.role.key}.name`) ? tr(`${s.role.key}.name`) : s.role.name,
          vias: [],
          scopes: [],
          expiresAt: null,
          permissions: [],
          viaSet: new Set<string>(),
          scopeSet: new Set<string>(),
          permSet: new Set<string>(),
        } as RoleRow & { viaSet: Set<string>; scopeSet: Set<string>; permSet: Set<string> });
      row.viaSet.add(s.via === 'group' ? t('via.group', { group: s.group?.name ?? '' }) : t(`via.${s.via}`));
      if (s.scopeType !== 'global')
        row.scopeSet.add(`${tc(`scope_values.${s.scopeType}`)}: ${s.scopeLabel ?? '—'}`);
      if (s.expiresAt && (!row.expiresAt || s.expiresAt < row.expiresAt)) row.expiresAt = s.expiresAt;
      row.permSet.add(s.permission);
      byRole.set(s.role.id, row);
    }
    return [...byRole.values()]
      .map(({ viaSet, scopeSet, permSet, ...r }) => ({
        ...r,
        vias: [...viaSet],
        scopes: [...scopeSet],
        permissions: [...permSet].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, t, tc, tr]);

  const permissionCount = new Set((data?.sources ?? []).map((s) => s.permission)).size;

  return (
    <Card id="access" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('summary', { roles: rows.length, permissions: permissionCount })}
            </p>
            <ul className="space-y-2">
              {rows.map((r) => {
                const expanded = open === r.id;
                return (
                  <li key={r.id} className="rounded-lg border">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : r.id)}
                      aria-expanded={expanded}
                      aria-controls={`access-${r.id}`}
                      className="flex w-full flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="text-sm font-medium">{r.name}</span>
                      {r.vias.map((v) => (
                        <Badge key={v} variant="secondary" className="font-normal">
                          {v}
                        </Badge>
                      ))}
                      {r.scopes.map((s) => (
                        <Badge key={s} variant="info" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                      {r.expiresAt && (
                        <Badge variant="warning" className="font-normal">
                          {t('expires', {
                            date: format.dateTime(new Date(r.expiresAt), { dateStyle: 'medium' }),
                          })}
                        </Badge>
                      )}
                      <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                        {t('permissionCount', { count: r.permissions.length })}
                        <ChevronDownIcon
                          className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          id={`access-${r.id}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5">
                            {r.permissions.map((p) => (
                              <code
                                key={p}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                                title={p === '*' ? t('allPermissions') : undefined}
                              >
                                {p === '*' ? `* · ${t('allPermissions')}` : p}
                              </code>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
