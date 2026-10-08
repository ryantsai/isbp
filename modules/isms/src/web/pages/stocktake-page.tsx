'use client';

import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ArrowLeftIcon, BadgeCheckIcon, DownloadIcon, FileQuestionIcon, XCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { STOCKTAKE_ITEM_VIEWS, type Stocktake, type StocktakeItem } from '../../contracts';
import { ProgressBar, ResultBadge, StocktakeStatusBadge, ValueBadge } from '../badges';
import { apiUrl, assetHref, INVALIDATE, useDay, useLocalized } from '../lib';
import { RecordItemDialog, SignOffDialog } from '../stocktake-dialogs';

type View = (typeof STOCKTAKE_ITEM_VIEWS)[number];

/** One stocktake: progress, the items (yours first), recording, export and sign-off. */
export default function StocktakePage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const api = useApi();
  const day = useDay();
  const locale = useLocale();
  const localized = useLocalized();
  const ref = params.ref ?? '';
  const mineId = useId();
  const [state, set] = useListState({ pageSize: 50 });
  const view: View = STOCKTAKE_ITEM_VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const mine = state.mine === 'true';
  const {
    data: st,
    isLoading,
    error,
  } = useApiQuery<Stocktake>(`/isms/stocktakes/${encodeURIComponent(ref)}`);
  const items = useApiQuery<Page<StocktakeItem>>(st ? `/isms/stocktakes/${st.reference}/items` : null, {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    view,
    mine: mine ? 'true' : undefined,
  });
  const [recording, setRecording] = useState<StocktakeItem | null>(null);
  const [signing, setSigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const signOff = useApiMutation(
    (_a, note: string | null) => api.post<Stocktake>(`/isms/stocktakes/${st!.reference}/sign-off`, { note }),
    { invalidate: INVALIDATE, success: t('stocktake.signedOff'), onSuccess: () => setSigning(false) },
  );
  const cancel = useApiMutation(() => api.post<Stocktake>(`/isms/stocktakes/${st!.reference}/cancel`, {}), {
    invalidate: INVALIDATE,
    success: t('stocktake.cancelled'),
    onSuccess: () => setCancelling(false),
  });

  const columns = useMemo<DataTableColumn<StocktakeItem>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.number'),
        size: 120,
        meta: { className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) =>
          row.original.assetId ? (
            <Link href={assetHref(row.original.snapshot.number)} className="hover:underline">
              {row.original.snapshot.number}
            </Link>
          ) : (
            row.original.snapshot.number
          ),
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{row.original.snapshot.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {localized(row.original.snapshot.className)} · {row.original.snapshot.location ?? '—'}
            </span>
          </span>
        ),
      },
      {
        id: 'value',
        header: t('fields.value'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <ValueBadge value={row.original.snapshot.value} />,
      },
      {
        id: 'assignee',
        header: t('fields.manager'),
        meta: { className: 'hidden max-w-44 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate">
            {row.original.assignee?.displayName ?? row.original.assigneeGroup?.name ?? (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        ),
      },
      {
        id: 'result',
        header: t('fields.result'),
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col gap-0.5">
            <ResultBadge result={row.original.result} />
            {row.original.note && (
              <span className="block max-w-56 truncate text-xs text-muted-foreground">
                {row.original.note}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        cell: ({ row }) =>
          row.original.canRecord && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setRecording(row.original);
              }}
              aria-label={t('record.openFor', { number: row.original.snapshot.number })}
            >
              {row.original.result ? t('record.change') : t('record.open')}
            </Button>
          ),
      },
    ],
    [t, tc, localized],
  );

  if (isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error || !st) return <EmptyState icon={<FileQuestionIcon />} title={t('stocktake.notFound')} />;
  const p = st.progress;
  const table = (
    <DataTable
      label={t('stocktake.items')}
      columns={columns}
      data={items.data?.items ?? []}
      total={items.data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      loading={items.isLoading}
      fetching={items.isFetching}
      getRowId={(i) => i.id}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('stocktake.search')}
            className="sm:w-64"
          />
          <div className="flex items-center gap-2">
            <Switch
              id={mineId}
              checked={mine}
              onCheckedChange={(v) => set({ mine: v ? 'true' : undefined })}
            />
            <label htmlFor={mineId} className="text-sm">
              {t('stocktake.onlyMine')}
            </label>
          </div>
        </>
      }
      empty={<EmptyState icon={<BadgeCheckIcon />} title={t('stocktake.noItems')} />}
    />
  );

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/isms/stocktakes">
          <ArrowLeftIcon /> {t('stocktakes.title')}
        </Link>
      </Button>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-mono text-sm text-muted-foreground">{st.reference}</p>
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{st.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StocktakeStatusBadge status={st.status} overdue={st.overdue} />
            <span>{t('stocktakes.dueOn', { date: day(st.dueOn) })}</span>
            {st.recurrence !== 'none' && <span>· {t(`recurrence.${st.recurrence}`)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={apiUrl(`/isms/stocktakes/${st.reference}/export.csv`, { locale })} download>
              <DownloadIcon /> {t('stocktake.export')}
            </a>
          </Button>
          {st.viewer.canManage && (st.status === 'open' || st.status === 'scheduled') && (
            <Button variant="outline" onClick={() => setCancelling(true)}>
              <XCircleIcon /> {t('stocktake.cancel')}
            </Button>
          )}
          {st.viewer.canSignOff && st.status === 'open' && (
            <Button onClick={() => setSigning(true)} disabled={p.done < p.total}>
              <BadgeCheckIcon /> {t('stocktake.signOff')}
            </Button>
          )}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('fields.progress')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProgressBar
            done={p.done}
            total={p.total}
            label={t('stocktakes.progressLabel', { name: st.name })}
          />
          <p className="text-sm text-muted-foreground">
            {t('stocktake.summary', { ...p.byResult, pending: p.total - p.done })}
          </p>
          {st.viewer.canSignOff && st.status === 'open' && p.done < p.total && (
            <p className="text-sm text-muted-foreground">{t('stocktake.signOffWhenDone')}</p>
          )}
          {st.signedOffBy && (
            <p className="text-sm">
              {t('stocktake.signedOffBy', { name: st.signedOffBy.displayName })}
              {st.signOffNote ? ` — ${st.signOffNote}` : ''}
            </p>
          )}
        </CardContent>
      </Card>
      {st.status === 'scheduled' ? (
        <p className="text-sm text-muted-foreground">{t('stocktake.scheduled', { date: day(st.startOn) })}</p>
      ) : (
        <Tabs
          value={view}
          onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}
          className="gap-4"
        >
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {STOCKTAKE_ITEM_VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`stocktake.views.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {STOCKTAKE_ITEM_VIEWS.map((v) => (
            <TabsContent key={v} value={v} className="min-w-0">
              {view === v && table}
            </TabsContent>
          ))}
        </Tabs>
      )}
      <RecordItemDialog
        stocktake={st.reference}
        item={recording}
        onOpenChange={(o) => !o && setRecording(null)}
      />
      <SignOffDialog
        open={signing}
        onOpenChange={setSigning}
        title={t('stocktake.signOffTitle', { reference: st.reference })}
        description={t('stocktake.signOffDescription')}
        onConfirm={(note) => signOff.mutate(note)}
        pending={signOff.isPending}
      />
      <AlertDialog open={cancelling} onOpenChange={setCancelling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('stocktake.cancelTitle', { reference: st.reference })}</AlertDialogTitle>
            <AlertDialogDescription>{t('stocktake.cancelDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                cancel.mutate(undefined);
              }}
            >
              {t('stocktake.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
