'use client';

import type { EffectivePermissions } from '@isbp/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Disclosure } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { ChevronDownIcon, ShieldCheckIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useRoleText } from '@/components/roles/role-utils';
import { useApiQuery } from '@/lib/api';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';

interface RoleRow {
  id: string;
  name: string;
  vias: string[];
  scopes: string[];
  expiresAt: string | null;
  permissions: string[];
  /** Granted to everyone by default (no assignment of the person's own). */
  baseline: boolean;
}

const BADGE = 'h-auto max-w-full font-normal whitespace-normal break-words text-left';

/** One role: its name, how it was granted, and (when opened) the permissions it carries. */
function RoleItem({ r, open, onToggle }: { r: RoleRow; open: boolean; onToggle: () => void }) {
  const t = useTranslations('settings.access');
  const format = useFormatter();
  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`access-${r.id}`}
        className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{r.name}</span>
        {r.vias.map((v) => (
          <Badge variant="neutral" label={v} key={v} className={BADGE} />
        ))}
        {r.scopes.map((s) => (
          <Badge variant="info" label={s} key={s} className={BADGE} />
        ))}
        {r.expiresAt && (
          <Badge
            variant="warning"
            label={t('expires', {
              date: format.dateTime(new Date(r.expiresAt), { dateStyle: 'medium' }),
            })}
            className={BADGE}
          />
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('permissionCount', { count: r.permissions.length })}
          <ChevronDownIcon
            className={`size-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
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
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] break-all text-muted-foreground"
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
}

/**
 * "What can I do and why" from `GET /me/permissions`: the roles the person was given first, with their end dates; the
 * baseline everyone has is one row, opened on demand.
 */
export function AccessCard() {
  const t = useTranslations('settings.access');
  const tc = useTranslations('common');
  const roleText = useRoleText();
  const { data, isLoading } = useApiQuery<EffectivePermissions>('/me/permissions');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo<RoleRow[]>(() => {
    const byRole = new Map<
      string,
      RoleRow & { viaSet: Set<string>; scopeSet: Set<string>; permSet: Set<string>; direct: boolean }
    >();
    for (const s of data?.sources ?? []) {
      const row =
        byRole.get(s.role.id) ??
        ({
          id: s.role.id,
          name: roleText(s.role).name,
          vias: [],
          scopes: [],
          expiresAt: null,
          permissions: [],
          baseline: true,
          direct: false,
          viaSet: new Set<string>(),
          scopeSet: new Set<string>(),
          permSet: new Set<string>(),
        } as RoleRow & { viaSet: Set<string>; scopeSet: Set<string>; permSet: Set<string>; direct: boolean });
      row.viaSet.add(s.via === 'group' ? t('via.group', { group: s.group?.name ?? '' }) : t(`via.${s.via}`));
      if (s.via !== 'everyone') row.direct = true;
      if (s.scopeType !== 'global')
        row.scopeSet.add(`${tc(`scope_values.${s.scopeType}`)}: ${s.scopeLabel ?? '—'}`);
      if (s.expiresAt && (!row.expiresAt || s.expiresAt < row.expiresAt)) row.expiresAt = s.expiresAt;
      row.permSet.add(s.permission);
      byRole.set(s.role.id, row);
    }
    return [...byRole.values()]
      .map(({ viaSet, scopeSet, permSet, direct, ...r }) => ({
        ...r,
        baseline: !direct,
        vias: [...viaSet],
        scopes: [...scopeSet],
        permissions: [...permSet].sort(),
      }))
      .sort((a, b) => Number(a.baseline) - Number(b.baseline) || a.name.localeCompare(b.name));
  }, [data, t, tc, roleText]);

  const permissionCount = new Set((data?.sources ?? []).map((s) => s.permission)).size;
  const granted = rows.filter((r) => !r.baseline);
  const baseline = rows.filter((r) => r.baseline);

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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {t('summary', { roles: rows.length, permissions: permissionCount })}
              </p>
              <Button
                label={t('request')}
                variant="secondary"
                size="sm"
                href="/requests/access"
                className="self-start sm:self-auto"
              />
            </div>
            {granted.length > 0 && (
              <ul className="space-y-2">
                {granted.map((r) => (
                  <RoleItem
                    key={r.id}
                    r={r}
                    open={open === r.id}
                    onToggle={() => setOpen(open === r.id ? null : r.id)}
                  />
                ))}
              </ul>
            )}
            {baseline.length > 0 && (
              <Disclosure
                summary={t('baseline', { count: baseline.length })}
                className="rounded-lg border"
                triggerClassName="w-full justify-between px-3 py-2.5 text-sm text-muted-foreground"
                contentClassName="px-3 pb-3"
              >
                <ul className="space-y-2">
                  {baseline.map((r) => (
                    <RoleItem
                      key={r.id}
                      r={r}
                      open={open === r.id}
                      onToggle={() => setOpen(open === r.id ? null : r.id)}
                    />
                  ))}
                </ul>
              </Disclosure>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
