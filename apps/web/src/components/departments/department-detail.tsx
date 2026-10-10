'use client';

import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { AnimatedNumber } from '@isbp/ui/motion';
import {
  ArrowRightIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import type { DepartmentNode } from '@/components/pickers/use-departments';
import { CustomFieldsCard } from '@/components/fields/entity-fields';
import { DateTime } from '@/components/relative-time';
import { ancestorIds } from './department-tree';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function totalMembers(node: DepartmentNode): number {
  return node.children.reduce((sum, c) => sum + totalMembers(c), node.memberCount);
}

const linkClass =
  'rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Everything about one department, plus its actions (gated per department by the caller). */
export function DepartmentDetail({
  node,
  byId,
  canManage,
  onSelect,
  onEdit,
  onAddChild,
  onDelete,
}: {
  node: DepartmentNode;
  byId: Map<string, DepartmentNode>;
  canManage: boolean;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('departments.detail');
  const tt = useTranslations('departments.tree');
  const canReadPeople = useCan('core.users.read');
  const titleId = useId();
  const subId = useId();
  const ancestors = ancestorIds(node)
    .map((id) => byId.get(id))
    .filter((d): d is DepartmentNode => Boolean(d));
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  const hasChildren = node.children.length > 0;
  const total = totalMembers(node);

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="gap-3">
        {ancestors.length > 0 && (
          <nav aria-label={t('breadcrumb')}>
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {ancestors.map((a) => (
                <li key={a.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(a.id)}
                    className={`${linkClass} hover:text-foreground`}
                  >
                    {a.name}
                  </button>
                  <ChevronRightIcon className="size-3" aria-hidden />
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight break-words">
              {node.name}
            </h2>
            <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {node.code}
            </code>
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <PencilIcon /> {t('edit')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label={t('more')}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onSelect={onAddChild}>
                    <PlusIcon /> {t('addSub')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={hasChildren}
                    onSelect={onDelete}
                    className="items-start"
                  >
                    <Trash2Icon className="mt-0.5" />
                    <span className="flex flex-col">
                      <span>{t('delete')}</span>
                      {hasChildren && (
                        <span className="text-xs text-muted-foreground">{t('deleteBlocked')}</span>
                      )}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{node.description || t('noDescription')}</p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">{t('peopleDirect')}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              <AnimatedNumber value={node.memberCount} />
            </p>
            {canReadPeople && (
              <Link
                href={`/admin/users?departmentId=${node.id}`}
                className={`${linkClass} mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary`}
              >
                {t('viewPeople')} <ArrowRightIcon className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">{t('peopleTotal')}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              <AnimatedNumber value={total} />
            </p>
            {canReadPeople && node.children.length > 0 && (
              <Link
                href={`/admin/users?departmentId=${node.id}&subtree=true`}
                className={`${linkClass} mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary`}
              >
                {t('viewPeople')} <ArrowRightIcon className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </div>

        <dl className="divide-y border-y">
          <Field label={t('manager')}>
            {node.manager ? (
              canReadPeople ? (
                <Link
                  href={`/admin/users/${node.manager.id}`}
                  className={`${linkClass} inline-flex items-center gap-2`}
                >
                  <UserAvatar name={node.manager.displayName} className="size-6 text-[10px]" />
                  {node.manager.displayName}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <UserAvatar name={node.manager.displayName} className="size-6 text-[10px]" />
                  {node.manager.displayName}
                </span>
              )
            ) : (
              <span className="text-muted-foreground">{t('noManager')}</span>
            )}
          </Field>
          <Field label={t('parent')}>
            {parent ? (
              <button type="button" onClick={() => onSelect(parent.id)} className={linkClass}>
                {parent.name}
              </button>
            ) : (
              <span className="text-muted-foreground">{t('topLevel')}</span>
            )}
          </Field>
          <Field label={t('created')}>
            <DateTime date={node.createdAt} />
          </Field>
        </dl>

        <CustomFieldsCard variant="section" entityType="core.department" attributes={node.attributes} />

        <section aria-labelledby={subId} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id={subId} className="flex items-center gap-2 text-sm font-medium">
              {t('subDepartments')}
              <Badge variant="muted" className="px-1.5 tabular-nums">
                {node.children.length}
              </Badge>
            </h3>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={onAddChild}>
                <PlusIcon /> {t('addSub')}
              </Button>
            )}
          </div>
          {hasChildren ? (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {node.children.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className="group flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <code className="block truncate font-mono text-xs text-muted-foreground">{c.code}</code>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {tt('people', { count: c.memberCount })}
                    </span>
                    <ChevronRightIcon
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noSubDepartments')}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
