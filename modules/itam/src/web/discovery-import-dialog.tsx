'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Table } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { FormDialog } from '@isbp/ui/form-dialog';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CircleAlertIcon, CircleCheckIcon, FileSpreadsheetIcon } from 'lucide-react';
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

/** One documented column of the CSV, as a table row. */
interface ColumnRow extends Record<string, unknown> {
  name: string;
  required: (typeof DISCOVERY_CSV_COLUMNS)[number]['required'];
}
const COLUMN_ROWS: ColumnRow[] = DISCOVERY_CSV_COLUMNS.map((c) => ({ name: c.name, required: c.required }));

/**
 * Imports an inventory tool's CSV export: the file is parsed here (columns documented in the dialog) and sent in
 * batches of whole devices to `POST /itam/discovery/import`, the same discovery service the API uses.
 */
export function DiscoveryImportDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('itam.discovery.importDialog');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<DiscoveryCsvResult | 'unreadable' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const fileName = file?.name ?? null;

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

  const choose = async (next: File | null) => {
    setTotals(null);
    setProgress(null);
    run.reset();
    setFile(next);
    if (!next) {
      setParsed(null);
      return;
    }
    try {
      setParsed(parseDiscoveryCsv(await next.text()));
    } catch {
      setParsed('unreadable');
    }
  };

  const ok = parsed && parsed !== 'unreadable' && parsed.ok ? parsed : null;
  const running = run.isPending;

  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => !running && onOpenChange(o)}
      size="xl"
      title={t('title')}
      subtitle={t('description')}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) run.mutate(ok.devices);
      }}
      submitLabel={totals ? undefined : t('submit', { count: ok?.devices.length ?? 0 })}
      isSubmitting={running}
      isSubmitDisabled={!ok || ok.devices.length === 0}
      cancelLabel={tc('close')}
    >
      <VStack gap={4}>
        <VStack as="section" gap={2} aria-labelledby={`${id}-columns`}>
          <Heading level={3} id={`${id}-columns`}>
            {t('columns')}
          </Heading>
          <Table
            data={COLUMN_ROWS}
            idKey="name"
            density="compact"
            columns={[
              {
                key: 'name',
                header: t('column'),
                renderCell: (c) => <Text type="code">{c.name}</Text>,
              },
              {
                key: 'required',
                header: t('required'),
                renderCell: (c) =>
                  t(
                    c.required === 'device'
                      ? 'requiredDevice'
                      : c.required === 'always'
                        ? 'requiredAlways'
                        : 'requiredNo',
                  ),
              },
              { key: 'meaning', header: t('meaning'), renderCell: (c) => t(`col.${c.name}`) },
            ]}
          />
          <Text type="supporting">{t('format')}</Text>
          <CodeBlock code={DISCOVERY_CSV_EXAMPLE} title={t('example')} width="100%" size="sm" />
        </VStack>

        <FileInput
          label={t('file')}
          accept=".csv,.txt,text/csv"
          isDisabled={running}
          value={file}
          onChange={(next) => void choose(Array.isArray(next) ? (next[0] ?? null) : next)}
        />

        <VStack gap={2} role="status" aria-live="polite">
          {parsed === 'unreadable' && <Problem>{t('errors.unreadable')}</Problem>}
          {parsed && parsed !== 'unreadable' && !parsed.ok && (
            <Problem>
              {parsed.error === 'missingColumns'
                ? t('errors.missingColumns', { columns: parsed.missing.join(', ') })
                : t(`errors.${parsed.error}`)}
            </Problem>
          )}
          {ok && !totals && !running && (
            <HStack gap={2} vAlign="start">
              <Icon icon={FileSpreadsheetIcon} color="accent" />
              <StackItem size="fill">
                <Text>
                  <Text weight="medium" wordBreak="break-all">
                    {fileName}
                  </Text>
                  : {t('parsed', { rows: ok.rows, devices: ok.devices.length })}
                </Text>
              </StackItem>
            </HStack>
          )}
          {ok && ok.issues.length > 0 && !totals && (
            <Banner status="warning" title={t('skipped', { count: ok.issues.length })} collapsible={false}>
              <List density="compact">
                {ok.issues.slice(0, SHOWN_ISSUES).map((i) => (
                  <ListItem key={i.line} label={t(`issues.${i.code}`, { line: i.line })} />
                ))}
                {ok.issues.length > SHOWN_ISSUES && (
                  <ListItem label={t('moreIssues', { count: ok.issues.length - SHOWN_ISSUES })} />
                )}
              </List>
            </Banner>
          )}
          {running && progress && <Text>{t('progress', progress)}</Text>}
          {run.isError && <Problem>{t('failed', { error: errorText(run.error) })}</Problem>}
          {totals && (
            <VStack gap={2}>
              <HStack gap={2} vAlign="start">
                <Icon icon={CircleCheckIcon} color="success" />
                <StackItem size="fill">
                  <Text>
                    {t('done', {
                      count: totals.imported,
                      added: totals.added,
                      updated: totals.updated,
                      removed: totals.removed,
                    })}
                  </Text>
                </StackItem>
              </HStack>
              {totals.notFound.length > 0 && (
                <VStack gap={1}>
                  <HStack gap={2} vAlign="start">
                    <Icon icon={CircleAlertIcon} color="warning" />
                    <StackItem size="fill">
                      <Text>{t('notFound', { count: totals.notFound.length })}</Text>
                    </StackItem>
                  </HStack>
                  <CodeBlock
                    code={totals.notFound.join('\n')}
                    width="100%"
                    size="sm"
                    maxHeight={128}
                    hasCopyButton={false}
                  />
                </VStack>
              )}
            </VStack>
          )}
        </VStack>
      </VStack>
    </FormDialog>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <HStack gap={2} vAlign="start">
      <Icon icon={CircleAlertIcon} color="error" />
      <StackItem size="fill">
        <Text>{children}</Text>
      </StackItem>
    </HStack>
  );
}
