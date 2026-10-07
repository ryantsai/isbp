'use client';

import { RelativeTime } from '@isbp/ui/relative-time';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { TicketListItem } from '../../contracts';
import { ticketHref, useCategoryLabel } from '../lib';
import { MajorBadge, PersonChip, PriorityBadge, SlaChip, TicketStatusBadge, TypeIcon } from './badges';

export type TicketColumn =
  | 'reference'
  | 'title'
  | 'requester'
  | 'status'
  | 'priority'
  | 'sla'
  | 'assignee'
  | 'group'
  | 'category'
  | 'window'
  | 'updated'
  | 'created';

/** Column set for ticket lists (agent workspace, problems, changes). */
export function useTicketColumns(columns: readonly TicketColumn[]) {
  const t = useTranslations('itsm.columns');
  const format = useFormatter();
  const categoryLabel = useCategoryLabel();
  return useMemo<ColumnDef<TicketListItem, unknown>[]>(() => {
    const all: Record<TicketColumn, ColumnDef<TicketListItem, unknown>> = {
      reference: {
        id: 'reference',
        header: t('reference'),
        meta: { sortKey: 'number' },
        cell: ({ row }) => (
          <Link
            href={ticketHref(row.original.reference)}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded font-mono text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <TypeIcon type={row.original.type} label className="size-3.5 text-muted-foreground" />
            {row.original.reference}
          </Link>
        ),
      },
      title: {
        id: 'title',
        header: t('title'),
        meta: { className: 'max-w-[22rem] min-w-48' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            {row.original.major && <MajorBadge className="shrink-0" />}
            <span className="truncate font-medium" title={row.original.title}>
              {row.original.title}
            </span>
          </div>
        ),
      },
      requester: {
        id: 'requester',
        header: t('requester'),
        meta: { className: 'max-w-44' },
        cell: ({ row }) => <PersonChip person={row.original.requester} />,
      },
      status: {
        id: 'status',
        header: t('status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
      },
      priority: {
        id: 'priority',
        header: t('priority'),
        meta: { sortKey: 'priority' },
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      sla: {
        id: 'sla',
        header: t('sla'),
        cell: ({ row }) => <SlaChip sla={row.original.sla} />,
      },
      assignee: {
        id: 'assignee',
        header: t('assignee'),
        meta: { className: 'max-w-44' },
        cell: ({ row }) =>
          row.original.assignee ? (
            <PersonChip person={row.original.assignee} />
          ) : (
            <span className="text-muted-foreground">{row.original.assignmentGroup?.name ?? '—'}</span>
          ),
      },
      group: {
        id: 'group',
        header: t('group'),
        meta: { className: 'max-w-44 truncate text-muted-foreground' },
        cell: ({ row }) => row.original.assignmentGroup?.name ?? '—',
      },
      category: {
        id: 'category',
        header: t('category'),
        meta: { className: 'max-w-52 truncate text-muted-foreground' },
        cell: ({ row }) => categoryLabel(row.original.category) ?? '—',
      },
      window: {
        id: 'window',
        header: t('window'),
        meta: { sortKey: 'plannedStart', className: 'text-muted-foreground' },
        cell: ({ row }) =>
          row.original.plannedStart && row.original.plannedEnd
            ? format.dateTimeRange(new Date(row.original.plannedStart), new Date(row.original.plannedEnd), {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—',
      },
      updated: {
        id: 'updated',
        header: t('updated'),
        meta: { sortKey: 'updatedAt', className: 'text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
      created: {
        id: 'created',
        header: t('created'),
        meta: { sortKey: 'createdAt', className: 'text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
    };
    return columns.map((c) => all[c]);
  }, [columns, t, format, categoryLabel]);
}
