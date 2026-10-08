'use client';

import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { CircleAlertIcon, CircleCheckIcon, FileSpreadsheetIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import {
  DISCOVERY_CSV_COLUMNS,
  DISCOVERY_CSV_EXAMPLE,
  type DiscoveryCsvResult,
  type DiscoveryImportResult,
  discoveryBatches,
  parseDiscoveryCsv,
} from '../contracts';
import { INVALIDATE } from './lib';

const SHOWN_ISSUES = 8;

type Totals = { imported: number; added: number; updated: number; removed: number; notFound: string[] };

/**
 * Imports an inventory tool's CSV export: the file is parsed here (columns documented in the dialog) and sent in
 * batches of whole devices to `POST /itam/discovery/import`, the same discovery service the API uses.
 */
export function DiscoveryImportDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('itam.discovery.importDialog');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DiscoveryCsvResult | 'unreadable' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);

  const run = useApiMutation(
    async (api, devices: Extract<DiscoveryCsvResult, { ok: true }>['devices']) => {
      const sum: Totals = { imported: 0, added: 0, updated: 0, removed: 0, notFound: [] };
      let done = 0;
      setProgress({ done, total: devices.length });
      for (const batch of discoveryBatches(devices)) {
        const res = await api.post<DiscoveryImportResult>('/itam/discovery/import', {
          fileName,
          devices: batch,
        });
        for (const r of res.results) {
          if (r.status === 'imported') {
            sum.imported++;
            sum.added += r.added;
            sum.updated += r.updated;
            sum.removed += r.removed;
          } else sum.notFound.push(r.device);
        }
        done += batch.length;
        setProgress({ done, total: devices.length });
      }
      return sum;
    },
    { invalidate: INVALIDATE, onSuccess: (sum) => setTotals(sum), silent: true },
  );

  const choose = async (file: File | undefined) => {
    setTotals(null);
    setProgress(null);
    run.reset();
    if (!file) {
      setFileName(null);
      setParsed(null);
      return;
    }
    setFileName(file.name);
    try {
      setParsed(parseDiscoveryCsv(await file.text()));
    } catch {
      setParsed('unreadable');
    }
  };

  const ok = parsed && parsed !== 'unreadable' && parsed.ok ? parsed : null;
  const running = run.isPending;

  return (
    <Dialog open onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <section aria-labelledby={`${id}-columns`} className="grid min-w-0 gap-2">
            <h3 id={`${id}-columns`} className="text-sm font-medium">
              {t('columns')}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('column')}</TableHead>
                  <TableHead>{t('required')}</TableHead>
                  <TableHead>{t('meaning')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DISCOVERY_CSV_COLUMNS.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-xs">{c.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t(
                        c.required === 'device'
                          ? 'requiredDevice'
                          : c.required === 'always'
                            ? 'requiredAlways'
                            : 'requiredNo',
                      )}
                    </TableCell>
                    <TableCell className="min-w-48 whitespace-normal">{t(`col.${c.name}`)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">{t('format')}</p>
            <div className="grid gap-1">
              <span id={`${id}-example`} className="text-xs font-medium">
                {t('example')}
              </span>
              <pre
                aria-labelledby={`${id}-example`}
                tabIndex={0}
                className="overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {DISCOVERY_CSV_EXAMPLE}
              </pre>
            </div>
          </section>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-file`}>{t('file')}</Label>
            <input
              id={`${id}-file`}
              type="file"
              accept=".csv,.txt,text/csv"
              disabled={running}
              onChange={(e) => void choose(e.target.files?.[0])}
              className="block w-full min-w-0 rounded-md border bg-background text-sm file:mr-3 file:border-0 file:border-r file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </div>

          <div role="status" aria-live="polite" className="grid gap-2 text-sm">
            {parsed === 'unreadable' && <Problem>{t('errors.unreadable')}</Problem>}
            {parsed && parsed !== 'unreadable' && !parsed.ok && (
              <Problem>
                {parsed.error === 'missingColumns'
                  ? t('errors.missingColumns', { columns: parsed.missing.join(', ') })
                  : t(`errors.${parsed.error}`)}
              </Problem>
            )}
            {ok && !totals && !running && (
              <p className="flex items-start gap-2">
                <FileSpreadsheetIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium break-all">{fileName}</span>:{' '}
                  {t('parsed', { rows: ok.rows, devices: ok.devices.length })}
                </span>
              </p>
            )}
            {ok && ok.issues.length > 0 && !totals && (
              <div className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 p-2">
                <p className="flex items-center gap-2 font-medium text-warning-foreground">
                  <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                  {t('skipped', { count: ok.issues.length })}
                </p>
                <ul className="grid gap-0.5 pl-6 text-xs">
                  {ok.issues.slice(0, SHOWN_ISSUES).map((i) => (
                    <li key={i.line}>{t(`issues.${i.code}`, { line: i.line })}</li>
                  ))}
                  {ok.issues.length > SHOWN_ISSUES && (
                    <li>{t('moreIssues', { count: ok.issues.length - SHOWN_ISSUES })}</li>
                  )}
                </ul>
              </div>
            )}
            {running && progress && <p>{t('progress', progress)}</p>}
            {run.isError && <Problem>{t('failed', { error: errorText(run.error) })}</Problem>}
            {totals && (
              <div className="grid gap-2">
                <p className="flex items-start gap-2">
                  <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <span>
                    {t('done', {
                      count: totals.imported,
                      added: totals.added,
                      updated: totals.updated,
                      removed: totals.removed,
                    })}
                  </span>
                </p>
                {totals.notFound.length > 0 && (
                  <div className="grid gap-1">
                    <p className="flex items-start gap-2">
                      <CircleAlertIcon
                        className="mt-0.5 size-4 shrink-0 text-warning-foreground"
                        aria-hidden
                      />
                      {t('notFound', { count: totals.notFound.length })}
                    </p>
                    <ul
                      tabIndex={0}
                      className="max-h-32 overflow-y-auto rounded-md border p-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {totals.notFound.map((d) => (
                        <li key={d} className="break-all">
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {tc('close')}
          </Button>
          {!totals && (
            <Button
              loading={running}
              disabled={!ok || ok.devices.length === 0}
              onClick={() => ok && run.mutate(ok.devices)}
            >
              {t('submit', { count: ok?.devices.length ?? 0 })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-destructive">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
