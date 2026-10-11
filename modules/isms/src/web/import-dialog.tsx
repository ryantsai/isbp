'use client';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FileInput } from '@astryxdesign/core/FileInput';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
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
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [report, setReport] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useApiMutation((api, dryRun: boolean) => api.post<R>(endpoint, { csv, dryRun }), {
    invalidate: INVALIDATE,
    silent: true,
  });
  const reset = () => {
    setFile(null);
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
      isOpen={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      width={672}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={title}
            subtitle={description}
            onOpenChange={(o) => {
              if (!o) reset();
              onOpenChange(o);
            }}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <VStack gap={1}>{help}</VStack>
              {!done && (
                <FileInput
                  label={t('file')}
                  accept=".csv,text/csv,text/plain"
                  value={file}
                  onChange={async (picked) => {
                    const next = Array.isArray(picked) ? (picked[0] ?? null) : picked;
                    setFile(next);
                    setReport(null);
                    setCsv(next ? await readTextFile(next) : null);
                  }}
                />
              )}
              <div role="status" aria-live="polite">
                <VStack gap={3}>
                  {report?.error && (
                    <Banner
                      status="error"
                      title={
                        report.error === 'missingColumns'
                          ? t('missingColumns', { columns: report.missing.map(columnLabel).join(', ') })
                          : t(`errors.${report.error}`)
                      }
                      collapsible={false}
                    />
                  )}
                  {report && !report.error && (
                    <>
                      <Banner
                        status="success"
                        title={
                          report.dryRun
                            ? t('checked', { summary: summary(report) })
                            : t('imported', { summary: summary(report) })
                        }
                        collapsible={false}
                      />
                      {report.issues.length > 0 && (
                        <VStack gap={1}>
                          <Text weight="medium">{t('skipped', { count: report.skipped })}</Text>
                          <List density="compact" hasDividers>
                            {report.issues.map((i, n) => (
                              <ListItem key={`${i.line}-${i.column}-${n}`} label={issueText(i)} />
                            ))}
                          </List>
                        </VStack>
                      )}
                    </>
                  )}
                </VStack>
              </div>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={done ? tc('close') : tc('cancel')}
                variant="ghost"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              />
              {!done && (
                <Button
                  label={t('check')}
                  variant="secondary"
                  isLoading={run.isPending && run.variables}
                  isDisabled={!csv}
                  onClick={() => check(true)}
                />
              )}
              {!done && (
                <Button
                  label={t('import')}
                  variant="primary"
                  isLoading={run.isPending && run.variables === false}
                  isDisabled={!csv || !report || !report.dryRun || Boolean(report.error)}
                  onClick={() => check(false)}
                />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
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
          <Text as="p">{t('import.assetsHelp')}</Text>
          <Text as="p" type="supporting">
            {REGISTER_COLUMNS.map((c) => t(`csvColumns.${c}`)).join(' · ')}
          </Text>
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
