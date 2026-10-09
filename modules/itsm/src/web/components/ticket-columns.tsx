'use client';

import { type DataTableColumn, DataTableSummary } from '@isbp/ui/data-table';
import { RelativeTime } from '@isbp/ui/relative-time';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { TicketListItem } from '../../contracts';
import { ticketHref, useCategoryLabel } from '../lib';
import {
  ChangeTypeBadge,
  MajorBadge,
  PersonChip,
  PriorityBadge,
  RiskBadge,
  SlaChip,
  TicketStatusBadge,
  TypeIcon,
} from './badges';

export type TicketColumn =
  | 'ticket'
  | 'reference'
  | 'title'
  | 'requester'
  | 'status'
  | 'priority'
  | 'sla'
  | 'owner'
  | 'assignee'
  | 'group'
  | 'category'
  | 'window'
  | 'changeType'
  | 'risk'
  | 'updated'
  | 'created';

/**
 * Column set for ticket lists (agent workspace, problems, changes). `ticket` is the identifying cell — reference,
 * title and the requester on a muted line — and, while the table is narrow (a phone), the row's status, priority and
 * SLA under it, so phones read each row as a card. Priority 2 columns hide on phones, 3 on narrow laptops.
 */
export function useTicketColumns(columns: readonly TicketColumn[]) {
  const t = useTranslations('itsm.columns');
  const format = useFormatter();
  const categoryLabel = useCategoryLabel();
  return useMemo<DataTableColumn<TicketListItem>[]>(() => {
    const windowOf = (r: TicketListItem) =>
      r.plannedStart && r.plannedEnd
        ? format.dateTimeRange(new Date(r.plannedStart), new Date(r.plannedEnd), {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';
    const all: Record<TicketColumn, DataTableColumn<TicketListItem>> = {
      ticket: {
        id: 'ticket',
        header: t('ticket'),
        meta: { sortKey: 'number', wrap: true, className: 'min-w-56 max-w-[30rem]' },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href={ticketHref(r.reference)}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded font-mono text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <TypeIcon type={r.type} label className="size-3.5 text-muted-foreground" />
                  {r.reference}
                </Link>
                {r.major && <MajorBadge className="shrink-0" />}
              </div>
              <p className="mt-0.5 line-clamp-2 font-medium wrap-break-word" title={r.title}>
                {r.title}
              </p>
              {r.requester && (
                <p className="truncate text-xs text-muted-foreground">{r.requester.displayName}</p>
              )}
              {columns.includes('status') && (
                <DataTableSummary>
                  <TicketStatusBadge status={r.status} signOff={r.awaitingSignOff} />
                  {columns.includes('priority') && <PriorityBadge priority={r.priority} />}
                  {columns.includes('sla') && r.sla && <SlaChip sla={r.sla} />}
                  {columns.includes('window') && <span>{windowOf(r)}</span>}
                </DataTableSummary>
              )}
            </div>
          );
        },
      },
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
        meta: { className: 'max-w-44', priority: 3 },
        cell: ({ row }) => <PersonChip person={row.original.requester} />,
      },
      status: {
        id: 'status',
        header: t('status'),
        meta: { sortKey: 'status', priority: columns.includes('ticket') ? 2 : 1 },
        cell: ({ row }) => (
          <TicketStatusBadge status={row.original.status} signOff={row.original.awaitingSignOff} />
        ),
      },
      priority: {
        id: 'priority',
        header: t('priority'),
        meta: { sortKey: 'priority', priority: 2 },
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      sla: {
        id: 'sla',
        header: t('sla'),
        meta: { sortKey: 'slaDue', priority: 2 },
        cell: ({ row }) => <SlaChip sla={row.original.sla} />,
      },
      owner: {
        id: 'owner',
        header: t('owner'),
        meta: { className: 'max-w-44', priority: 2 },
        cell: ({ row }) =>
          row.original.assignee ? (
            <PersonChip person={row.original.assignee} />
          ) : (
            <span className="block truncate text-muted-foreground">
              {row.original.assignmentGroup?.name ?? '—'}
            </span>
          ),
      },
      assignee: {
        id: 'assignee',
        header: t('assignee'),
        meta: { className: 'max-w-44', priority: 2 },
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
        meta: { className: 'max-w-44 truncate text-muted-foreground', priority: 3 },
        cell: ({ row }) => row.original.assignmentGroup?.name ?? '—',
      },
      category: {
        id: 'category',
        header: t('category'),
        meta: { className: 'max-w-52 truncate text-muted-foreground', priority: 3 },
        cell: ({ row }) => categoryLabel(row.original.category) ?? '—',
      },
      window: {
        id: 'window',
        header: t('window'),
        meta: { sortKey: 'plannedStart', className: 'text-muted-foreground', priority: 2 },
        cell: ({ row }) => windowOf(row.original),
      },
      changeType: {
        id: 'changeType',
        header: t('changeType'),
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.changeType ? <ChangeTypeBadge type={row.original.changeType} /> : '—',
      },
      risk: {
        id: 'risk',
        header: t('risk'),
        meta: { priority: 3 },
        cell: ({ row }) => (row.original.risk ? <RiskBadge risk={row.original.risk} /> : '—'),
      },
      updated: {
        id: 'updated',
        header: t('updated'),
        meta: { sortKey: 'updatedAt', className: 'text-muted-foreground', priority: 3 },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
      created: {
        id: 'created',
        header: t('created'),
        meta: { sortKey: 'createdAt', className: 'text-muted-foreground', priority: 3 },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
    };
    return columns.map((c) => all[c]);
  }, [columns, t, format, categoryLabel]);
}
