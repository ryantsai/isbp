'use client';

import type { Role } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  SearchXIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { RequestBadges } from './request-settings';
import { useRoleText } from './role-utils';

function RoleCard({ role }: { role: Role }) {
  const t = useTranslations('roles');
  const roleText = useRoleText();
  const { name, description } = roleText(role);
  const shown = role.permissions.slice(0, 3);
  return (
    <StaggerItem className="h-full">
      <Link
        href={`/admin/roles/${role.id}`}
        className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Card className="h-full gap-0 py-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-ring/30 group-hover:shadow-md motion-reduce:group-hover:translate-y-0">
          <CardContent className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${role.isSystem ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
                aria-hidden
              >
                {role.isSystem ? <ShieldIcon className="size-4" /> : <ShieldCheckIcon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-medium">{name}</h3>
                  {role.isSystem && (
                    <Badge variant="muted" className="shrink-0">
                      <LockIcon aria-hidden />
                      {t('badges.system')}
                    </Badge>
                  )}
                </div>
                <code className="block truncate font-mono text-xs text-muted-foreground">{role.key}</code>
              </div>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {description || t('card.noDescription')}
            </p>
            <div className="mt-auto flex flex-wrap gap-1">
              {shown.map((p) => (
                <code
                  key={p}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {p === '*' ? t('card.fullAccess') : p}
                </code>
              ))}
              {role.permissions.length > shown.length && (
                <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                  {t('card.more', { count: role.permissions.length - shown.length })}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <KeyRoundIcon className="size-3.5" aria-hidden />
                {t('card.permissions', { count: role.permissions.length })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UsersIcon className="size-3.5" aria-hidden />
                {t('card.assignments', { count: role.assignmentCount })}
              </span>
              {role.requestable && (
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  <RequestBadges role={role} />
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </Link>
    </StaggerItem>
  );
}

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="font-semibold tracking-tight">{title}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
        <p className="ml-2 hidden truncate text-sm text-muted-foreground md:block">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3';

/** Roles tab: searchable card grid split into system (read-only) and custom roles. */
export function RoleGrid({ onCreate }: { onCreate?: () => void }) {
  const t = useTranslations('roles');
  const roleText = useRoleText();
  const [q, setQ] = useState('');
  const { data, isLoading } = useApiQuery<{ items: Role[] }>('/roles');

  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-9 w-full sm:w-72" />
        <div className={GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const roles = data.items.filter((r) => {
    if (!needle) return true;
    const { name, description } = roleText(r);
    return [name, r.name, r.key, description ?? ''].some((s) => s.toLowerCase().includes(needle));
  });
  const system = roles.filter((r) => r.isSystem);
  const custom = roles.filter((r) => !r.isSystem);

  return (
    <div className="space-y-8">
      <SearchInput value={q} onChange={setQ} delay={0} placeholder={t('searchRoles')} />

      {needle && roles.length === 0 && <EmptyState icon={<SearchXIcon />} title={t('noRolesMatch', { q })} />}

      {system.length > 0 && (
        <Section title={t('systemRoles')} hint={t('systemRolesHint')} count={system.length}>
          <Stagger className={GRID}>
            {system.map((r) => (
              <RoleCard key={r.id} role={r} />
            ))}
          </Stagger>
        </Section>
      )}

      {(!needle || custom.length > 0) && (
        <Section title={t('customRoles')} hint={t('customRolesHint')} count={custom.length}>
          {custom.length === 0 ? (
            <Card className="py-0">
              <EmptyState
                icon={<ShieldCheckIcon />}
                title={t('noCustomRoles.title')}
                description={t('noCustomRoles.description')}
                action={
                  onCreate && (
                    <Button variant="outline" onClick={onCreate}>
                      <PlusIcon /> {t('newRole')}
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <Stagger className={GRID}>
              {custom.map((r) => (
                <RoleCard key={r.id} role={r} />
              ))}
            </Stagger>
          )}
        </Section>
      )}
    </div>
  );
}
