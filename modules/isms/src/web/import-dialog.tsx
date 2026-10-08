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
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { type AssetImportReport, REGISTER_COLUMNS, type ReviewImportReport } from '../contracts';
import { INVALIDATE, readTextFile } from './lib';

interface Issue {
  line: number;
  column: string | null;
  code: string;
  value: string | null;
}
interface BaseReport {
  dryRun: boolean;
  error: 'empty' | 'tooManyRows' | 'missingColumns' | null;
  missing: string[];
  rows: number;
  skipped: number;
  issues: Issue[];
}

/**
 * Pick a CSV file, check it (dry run: what would be created, updated or skipped, line by line), then import. The
 * server parses and validates; the browser only reads the file.
 */
export function CsvImportDialog<R extends BaseReport>({
  open,
  onOpenChange,
  title,
  description,
  help,
  endpoint,
  columnLabel,
  summary,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  help: ReactNode;
  endpoint: string;
  columnLabel: (column: string) => string;
  summary: (report: R) => string;
  onImported?: (report: R) => void;
}) {
  const t = useTranslations('isms.import');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const fileId = useId();
  const [csv, setCsv] = useState<string | null>(null);
  const [report, setReport] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useApiMutation((api, dryRun: boolean) => api.post<R>(endpoint, { csv, dryRun }), {
    invalidate: INVALIDATE,
    silent: true,
  });
  const reset = () => {
    setCsv(null);
    setReport(null);
    setError(null);
  };
  const check = async (dryRun: boolean) => {
    setError(null);
    try {
      const r = await run.mutateAsync(dryRun);
      setReport(r);
      if (!dryRun && !r.error) onImported?.(r);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const issueText = (i: Issue) =>
    t('issueLine', {
      line: i.line,
      column: i.column ? columnLabel(i.column) : '—',
      problem: t(`issues.${i.code}` as 'issues.required'),
      value: i.value ?? '',
    });
  const done = report && !report.dryRun;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="text-sm text-muted-foreground">{help}</div>
          {!done && (
            <div className="grid gap-2">
              <Label htmlFor={fileId}>{t('file')}</Label>
              <Input
                id={fileId}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  setReport(null);
                  setCsv(file ? await readTextFile(file) : null);
                }}
              />
            </div>
          )}
          <div role="status" aria-live="polite" className="space-y-3">
            {report?.error && (
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {report.error === 'missingColumns'
                  ? t('missingColumns', { columns: report.missing.map(columnLabel).join(', ') })
                  : t(`errors.${report.error}`)}
              </p>
            )}
            {report && !report.error && (
              <div className="space-y-2">
                <p className="flex items-start gap-2 text-sm">
                  <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  {report.dryRun
                    ? t('checked', { summary: summary(report) })
                    : t('imported', { summary: summary(report) })}
                </p>
                {report.issues.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t('skipped', { count: report.skipped })}</p>
                    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
                      {report.issues.map((i, n) => (
                        <li key={`${i.line}-${i.column}-${n}`} className="wrap-anywhere">
                          {issueText(i)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {done ? tc('close') : tc('cancel')}
          </Button>
          {!done && (
            <Button
              type="button"
              variant="secondary"
              disabled={!csv}
              loading={run.isPending && run.variables}
              onClick={() => check(true)}
            >
              {t('check')}
            </Button>
          )}
          {!done && (
            <Button
              type="button"
              disabled={!csv || !report || !report.dryRun || Boolean(report.error)}
              loading={run.isPending && run.variables === false}
              onClick={() => check(false)}
            >
              {t('import')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Import the register from CSV (the export's columns, in any of the three languages). */
export function ImportAssetsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms');
  return (
    <CsvImportDialog<AssetImportReport & BaseReport>
      open={open}
      onOpenChange={onOpenChange}
      title={t('import.assetsTitle')}
      description={t('import.assetsDescription')}
      help={
        <>
          <p>{t('import.assetsHelp')}</p>
          <p className="mt-1 text-xs">{REGISTER_COLUMNS.map((c) => t(`csvColumns.${c}`)).join(' · ')}</p>
        </>
      }
      endpoint="/isms/assets/import"
      columnLabel={(c) =>
        (REGISTER_COLUMNS as readonly string[]).includes(c) ? t(`csvColumns.${c as 'name'}`) : c
      }
      summary={(r) =>
        t('import.assetsSummary', { created: r.created, updated: r.updated, unchanged: r.unchanged })
      }
    />
  );
}

export type { ReviewImportReport };
