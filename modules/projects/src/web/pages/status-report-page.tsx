'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { useListState } from '@isbp/ui/data-table';
import { DownloadButton } from '@isbp/ui/download-button';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileChartColumnIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { StatusReport } from '../../contracts';
import { apiUrl } from '../lib';
import { ProjectsTabs } from '../section-tabs';
import { usePeriodLabel } from '../status/period';
import { ReportSectionCard } from '../status/report-sections';

const SCOPES = ['all', 'mine', 'department'] as const;
type Scope = (typeof SCOPES)[number];
const NONE = '__none__';

function ReportSkeleton() {
  return (
    <div className="grid gap-4" aria-busy>
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/**
 * The status report: which projects are delayed, at risk or on track in a period, from the status updates and the
 * plan, laid out by a template, for the projects the reader may see. Copy or download it as Markdown.
 */
export default function StatusReportPage() {
  const t = useTranslations('projects.report');
  const locale = useLocale();
  const errorText = useErrorText();
  const periodLabel = usePeriodLabel();
  const [state, set] = useListState();
  const scope: Scope = SCOPES.includes(state.scope as Scope) ? (state.scope as Scope) : 'all';
  const query = {
    period: (state.period as string | undefined) || undefined,
    template: (state.template as string | undefined) || undefined,
    scope,
    department: scope === 'department' ? (state.department as string | undefined) || undefined : undefined,
  };
  const ready = scope !== 'department' || Boolean(query.department);
  const [pending, setPending] = useState(false);
  const q = useApiQuery<StatusReport>(ready ? '/projects/status-report' : null, query, {
    refetchInterval: pending ? 4_000 : undefined,
  });
  const departments = useApiQuery<{ items: { id: string; name: string }[] }>(
    scope === 'department' ? '/projects/lookups/departments' : null,
  );
  const report = q.data;
  const isPending = report?.narrative.state === 'pending';
  // Poll while the AI writes the narrative (the job stores it; the next read returns it).
  useEffect(() => setPending(isPending), [isPending]);

  const exportQuery = {
    ...query,
    period: report?.period.key ?? query.period,
    template: report?.template.key,
  };
  const copy = async () => {
    try {
      const res = await fetch(apiUrl('/projects/status-report/export', exportQuery), {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      toast.success(t('copied'));
    } catch (err) {
      toast.error(t('copyFailed'), { description: errorText(err) });
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          report ? (
            <HStack gap={2} wrap="wrap">
              <Button
                label={t('copy')}
                variant="secondary"
                icon={<Icon icon={ClipboardCopyIcon} />}
                onClick={() => void copy()}
              />
              <DownloadButton
                label={t('download')}
                variant="secondary"
                icon={<Icon icon={DownloadIcon} />}
                href={apiUrl('/projects/status-report/export', exportQuery)}
                download={`status-report-${report.period.key}.md`}
              />
            </HStack>
          ) : undefined
        }
      />
      <ProjectsTabs />
      <HStack gap={3} vAlign="end" wrap="wrap">
        <HStack gap={1} vAlign="center" aria-label={t('periodNav')} role="group">
          <IconButton
            label={t('previousPeriod')}
            icon={<Icon icon={ChevronLeftIcon} />}
            variant="ghost"
            isDisabled={!report}
            onClick={() => report && set({ period: report.previousKey })}
          />
          <Text weight="medium" aria-live="polite">
            {report ? periodLabel(report.period) : '…'}
          </Text>
          <IconButton
            label={t('nextPeriod')}
            icon={<Icon icon={ChevronRightIcon} />}
            variant="ghost"
            isDisabled={!report?.nextKey}
            onClick={() => report?.nextKey && set({ period: report.nextKey })}
          />
          {report && !report.current && (
            <Button
              label={t('thisPeriod')}
              variant="ghost"
              size="sm"
              onClick={() => set({ period: undefined })}
            />
          )}
        </HStack>
        {report && (
          <Selector
            label={t('template')}
            width={240}
            value={report.template.key}
            onChange={(v) => set({ template: v })}
            options={report.templates.map((tpl) => ({ value: tpl.key, label: localize(tpl.name, locale) }))}
          />
        )}
        <SegmentedControl
          label={t('scope')}
          value={scope}
          onChange={(v) => set({ scope: v === 'all' ? undefined : v, department: undefined })}
        >
          {SCOPES.map((s) => (
            <SegmentedControlItem key={s} value={s} label={t(`scopes.${s}`)} />
          ))}
        </SegmentedControl>
        {scope === 'department' && (
          <Selector
            label={t('department')}
            width={240}
            hasSearch
            value={query.department ?? NONE}
            onChange={(v) => set({ department: v === NONE ? undefined : v })}
            options={[
              { value: NONE, label: t('chooseDepartment'), disabled: true },
              ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        )}
      </HStack>

      {!ready ? (
        <EmptyState icon={<FileChartColumnIcon />} title={t('chooseDepartment')} />
      ) : q.error && !report ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} kind="page" />
      ) : !report ? (
        <ReportSkeleton />
      ) : report.counts.total === 0 ? (
        <EmptyState
          icon={<FileChartColumnIcon />}
          title={t('empty')}
          description={scope === 'all' ? t('emptyHint') : t('emptyScopeHint')}
        />
      ) : (
        <>
          {report.narrative.state === 'pending' && (
            <Banner status="info" title={t('writing')} description={t('writingHint')} collapsible={false} />
          )}
          {report.narrative.state === 'failed' && (
            <Banner status="warning" title={t('aiFailed')} collapsible={false} />
          )}
          {report.truncated && <Banner status="warning" title={t('truncated')} collapsible={false} />}
          {report.template.sections.map((s) => (
            <ReportSectionCard key={s.id} section={s} report={report} />
          ))}
        </>
      )}
    </div>
  );
}
