'use client';

import type { CatalogDto } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { SearchInput } from '@isbp/ui/search-input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ChevronRightIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  SquareFunctionIcon,
  TableIcon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiQuery, useErrorText } from '@/lib/api';
import type { DbConnection } from './parts';

/** Tables, views and routines visible to the connection's login (admin page). */
export function CatalogSheet({
  connection,
  onOpenChange,
}: {
  connection: DbConnection | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('databases.catalog');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [q, setQ] = useState('');
  const [refresh, setRefresh] = useState(0);
  const { data, isLoading, isFetching, error } = useApiQuery<CatalogDto>(
    connection ? `/databases/${connection.id}/catalog` : null,
    refresh ? { refresh: true, n: refresh } : undefined,
  );
  const needle = q.trim().toLowerCase();
  const match = (...s: string[]) => !needle || s.some((x) => x.toLowerCase().includes(needle));
  const tables = (data?.tables ?? []).filter((tb) =>
    match(tb.schema, tb.name, ...tb.columns.map((c) => c.name)),
  );
  const routines = (data?.procedures ?? []).filter((p) => match(p.schema, p.name));

  return (
    <Sheet open={Boolean(connection)} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title', { name: connection?.name ?? '' })}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5 pb-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:flex-1" />
            <Button
              variant="outline"
              onClick={() => setRefresh((n) => n + 1)}
              loading={isFetching && !isLoading}
            >
              <RefreshCwIcon /> {t('refresh')}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('failed')}: {errorText(error)}
            </p>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <>
              {data?.truncated && <p className="text-xs text-muted-foreground">{t('truncated')}</p>}
              <section aria-labelledby="catalog-tables" className="space-y-2">
                <h3 id="catalog-tables" className="text-sm font-semibold">
                  {t('tables')} <span className="font-normal text-muted-foreground">({tables.length})</span>
                </h3>
                {tables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{needle ? t('noMatch', { q }) : t('empty')}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {tables.slice(0, 500).map((tb) => (
                      <li key={`${tb.schema}.${tb.name}`}>
                        <details className="group">
                          <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                            <ChevronRightIcon
                              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
                              aria-hidden
                            />
                            <TableIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="min-w-0 truncate font-mono">
                              {tb.schema}.{tb.name}
                            </span>
                            <Badge variant="muted" className="ml-auto">
                              {tb.kind === 'view' ? t('view') : t('table')}
                            </Badge>
                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                              {t('columns', { count: tb.columns.length })}
                            </span>
                          </summary>
                          <ul className="space-y-1 border-t bg-muted/30 px-3 py-2 pl-12 text-xs">
                            {tb.columns.map((c) => (
                              <li key={c.name} className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate font-mono">{c.name}</span>
                                <span className="text-muted-foreground">{c.type}</span>
                                {c.key && (
                                  <span className="flex items-center gap-1 text-muted-foreground">
                                    <KeyRoundIcon className="size-3" aria-hidden />
                                    {t('keyColumn')}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="catalog-routines" className="space-y-2">
                <h3 id="catalog-routines" className="text-sm font-semibold">
                  {t('routines')}{' '}
                  <span className="font-normal text-muted-foreground">({routines.length})</span>
                </h3>
                {routines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{needle ? t('noMatch', { q }) : t('empty')}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {routines.slice(0, 500).map((p) => {
                      const inputs = p.parameters.filter((x) => x.direction !== 'out');
                      return (
                        <li
                          key={`${p.schema}.${p.name}`}
                          className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 text-sm"
                        >
                          <SquareFunctionIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0 truncate font-mono">
                            {p.schema}.{p.name}({inputs.map((x) => x.name).join(', ')})
                          </span>
                          <Badge variant="muted">
                            {p.kind === 'function' ? t('function') : t('procedure')}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {t('params', { count: inputs.length })}
                            {p.returns ? ` · ${t('returns', { type: p.returns })}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
