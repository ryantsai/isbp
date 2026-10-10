'use client';

import {
  FORM_ASSIGNMENT_STATES,
  type FormAssignment,
  type FormAssignmentCompliance,
  type FormAssignmentState,
  type FormDetail,
} from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { Hint } from '@isbp/ui/tooltip';
import {
  BanIcon,
  CalendarSyncIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClipboardCheckIcon,
  ClockAlertIcon,
  PlusIcon,
  SearchXIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useNow, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime } from '@/components/relative-time';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { AssignDialog } from './assign-dialog';
import { AssignmentDueBadge, AssignmentStateBadge } from './assignment-badges';

const ALL = '__all__';
const NO_PERIOD = '—';

function AssigneeCell({ a }: { a: FormAssignment }) {
  const t = useTranslations('assignments.admin');
  if (!a.assignee) return <span className="text-muted-foreground">{t('deleted')}</span>;
  if (a.assignee.type === 'group')
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <UsersRoundIcon className="size-3.5" aria-hidden />
        </span>
        <span className="truncate">{a.assignee.group.name}</span>
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar
        name={a.assignee.user.displayName}
        src={a.assignee.user.avatarUrl}
        className="size-6 text-[10px]"
      />
      <span className="truncate">{a.assignee.user.displayName}</span>
    </span>
  );
}

/** Per period: done on time, late, overdue, open and cancelled — a table, with status words and icons in the header. */
function ComplianceCard({ formId }: { formId: string }) {
  const t = useTranslations('assignments.admin.compliance');
  const { data } = useApiQuery<FormAssignmentCompliance>(`/forms/${formId}/assignments/compliance`);
  if (!data?.periods.length) return null;
  const sum = (k: 'onTime' | 'late' | 'overdue') => data.periods.reduce((n, p) => n + p[k], 0);
  const cols = [
    { key: 'onTime', icon: CircleCheckIcon, className: 'text-success' },
    { key: 'late', icon: ClockAlertIcon, className: 'text-warning-foreground' },
    { key: 'overdue', icon: TriangleAlertIcon, className: 'text-destructive' },
    { key: 'open', icon: CircleDotIcon, className: 'text-info' },
    { key: 'cancelled', icon: BanIcon, className: 'text-muted-foreground' },
  ] as const;
  return (
    <Card className="min-w-0">
      <CardHeader>
        {/* A section of the tab (its heading is the h2 "Assignments"). */}
        <CardTitle role="heading" aria-level={3}>
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm">
          {t('summary', {
            periods: data.periods.length,
            onTime: sum('onTime'),
            late: sum('late'),
            overdue: sum('overdue'),
          })}
        </p>
        <Table aria-label={t('title')} scrollable>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('period')}</TableHead>
              {cols.map((c) => (
                <TableHead key={c.key} scope="col" className="text-right">
                  <span className="inline-flex items-center gap-1">
                    <c.icon className={`size-3.5 ${c.className}`} aria-hidden />
                    {t(c.key)}
                  </span>
                </TableHead>
              ))}
              <TableHead scope="col" className="text-right">
                {t('total')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.periods.map((p) => (
              <TableRow key={p.periodKey ?? NO_PERIOD}>
                <TableHead scope="row" className="font-mono text-xs">
                  {p.periodKey ?? t('noPeriod')}
                </TableHead>
                {cols.map((c) => (
                  <TableCell
                    key={c.key}
                    className={`text-right tabular-nums ${p[c.key] && c.key === 'overdue' ? 'font-semibold text-destructive' : ''}`}
                  >
                    {p[c.key]}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{p.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * The form admin page's "Assignments" tab: the compliance summary per period, the assignments (status, period,
 * assignee, due date, the request that completed them) with filters, "Assign" and cancelling open ones.
 */
export function FormAssignments({ form }: { form: FormDetail }) {
  const t = useTranslations('assignments.admin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const now = useNow({ updateInterval: 60_000 });
  const { enabledModules } = usePlatform();
  const [state, set] = useListState({ pageSize: 25 });
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState<FormAssignment | null>(null);
  const stateFilter = FORM_ASSIGNMENT_STATES.includes(state.state as FormAssignmentState)
    ? (state.state as FormAssignmentState)
    : undefined;
  const period = typeof state.period === 'string' ? state.period : undefined;
  const q = typeof state.q === 'string' ? state.q : '';
  const path = `/forms/${form.id}/assignments`;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<FormAssignment>>(path, {
    page: state.page,
    pageSize: state.pageSize,
    state: stateFilter,
    period,
    q: q || undefined,
  });
  const compliance = useApiQuery<FormAssignmentCompliance>(`${path}/compliance`);
  const periods = (compliance.data?.periods ?? [])
    .map((p) => p.periodKey)
    .filter((k): k is string => Boolean(k));
  const filtered = Boolean(stateFilter || period || q);
  const assignable = form.publishedVersion !== null && !form.archived;

  const cancel = useApiMutation(
    (api, id: string) => api.post<FormAssignment>(`/form-assignments/${id}/cancel`, {}),
    {
      invalidate: [path, '/me/form-assignments'],
      success: t('cancelled'),
      onSuccess: () => setCancelling(null),
    },
  );

  const columns = useMemo<DataTableColumn<FormAssignment>[]>(
    () => [
      {
        id: 'title',
        header: t('columns.title'),
        cell: ({ row }) => (
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate font-medium">{row.original.title}</span>
            {row.original.periodKey && (
              <span className="font-mono text-xs text-muted-foreground">{row.original.periodKey}</span>
            )}
          </span>
        ),
      },
      {
        id: 'assignee',
        header: t('columns.assignee'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => <AssigneeCell a={row.original} />,
      },
      {
        id: 'due',
        header: t('columns.due'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) =>
          row.original.status === 'open' ? (
            <AssignmentDueBadge dueAt={row.original.dueAt} now={now} />
          ) : (
            <DateTime date={row.original.dueAt} className="text-sm text-muted-foreground" />
          ),
      },
      {
        id: 'state',
        header: t('columns.state'),
        cell: ({ row }) => <AssignmentStateBadge state={row.original.state} />,
      },
      {
        id: 'completed',
        header: t('columns.completed'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) =>
          row.original.submission ? (
            <span className="grid gap-0.5">
              <Link
                href={`/requests/${row.original.submission.reference}`}
                aria-label={t('openRequest', { reference: row.original.submission.reference })}
                className="w-fit rounded-sm font-mono text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {row.original.submission.reference}
              </Link>
              <DateTime date={row.original.completedAt} className="text-xs text-muted-foreground" />
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'source',
        header: t('columns.source'),
        meta: {
          className: 'hidden text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-sm">
            {row.original.source.type === 'job' ? (
              <CalendarSyncIcon className="size-3.5" aria-hidden />
            ) : (
              <ClipboardCheckIcon className="size-3.5" aria-hidden />
            )}
            {t(row.original.source.type === 'job' ? 'source.job' : 'source.manual')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('columns.actions')}</span>,
        meta: { className: 'w-10 text-right' },
        cell: ({ row }) =>
          row.original.status === 'open' ? (
            <Hint label={t('cancel')}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`${t('cancel')}: ${row.original.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCancelling(row.original);
                }}
              >
                <XIcon />
              </Button>
            </Hint>
          ) : null,
      },
    ],
    [t, now],
  );

  const scheduleHref = `/scheduler/jobs/new?type=core.assign-form&name=${encodeURIComponent(
    localize(form.name, locale),
  )}&config=${encodeURIComponent(
    JSON.stringify({
      formKey: form.key,
      period: 'month',
      due: { type: 'end-of-period' },
      title: `${localize(form.name, locale)} {{period}}`,
    }),
  )}`;

  const assigneeName = (a: FormAssignment) =>
    !a.assignee
      ? t('deleted')
      : a.assignee.type === 'group'
        ? a.assignee.group.name
        : a.assignee.user.displayName;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 gap-1">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          {!assignable && (
            <p className="text-sm text-muted-foreground">
              {form.archived ? t('archived') : t('notPublished')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {enabledModules.includes('scheduler') && assignable && (
            <Button variant="outline" asChild>
              <Link href={scheduleHref}>
                <CalendarSyncIcon />
                {t('schedule')}
              </Link>
            </Button>
          )}
          <Button onClick={() => setAssigning(true)} disabled={!assignable}>
            <PlusIcon />
            {t('assign')}
          </Button>
        </div>
      </div>

      <ComplianceCard formId={form.id} />

      <DataTable
        label={t('label')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(a) => a.id}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <>
            <SearchInput value={q} onChange={(v) => set({ q: v || undefined })} placeholder={t('search')} />
            <Select
              value={stateFilter ?? ALL}
              onValueChange={(v) => set({ state: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label={t('stateFilter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allStates')}</SelectItem>
                {FORM_ASSIGNMENT_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <AssignmentStateBadge state={s} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(periods.length > 0 || period) && (
              <Select value={period ?? ALL} onValueChange={(v) => set({ period: v === ALL ? undefined : v })}>
                <SelectTrigger className="w-full sm:w-40" aria-label={t('periodFilter')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allPeriods')}</SelectItem>
                  {[...new Set([...(period ? [period] : []), ...periods])].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ state: undefined, period: undefined, q: undefined })}
              >
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          filtered ? (
            <EmptyState icon={<SearchXIcon />} title={t('emptyFiltered')} />
          ) : (
            <EmptyState
              icon={<ClipboardCheckIcon />}
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          )
        }
      />

      <AssignDialog form={form} open={assigning} onOpenChange={setAssigning} />
      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t('cancelTitle')}
        description={
          cancelling
            ? t('cancelBody', { title: cancelling.title, assignee: assigneeName(cancelling) })
            : undefined
        }
        confirmLabel={t('cancel')}
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </div>
  );
}
