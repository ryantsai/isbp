'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useApiQuery } from '@isbp/ui/query';
import { CheckCircle2Icon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { changeTypeSchema, riskSchema } from '../../contracts';
import { fromLocalInput, ticketHref } from '../lib';
import type { ChangeConflict, ChangeType, Risk } from '../types';
import { TicketStatusBadge } from './badges';

export interface ChangePlanValues {
  changeType: ChangeType;
  risk: Risk;
  reason: string;
  /** Local date-time values (`YYYY-MM-DDTHH:mm`, the browser's time zone). */
  plannedStart: string;
  plannedEnd: string;
  implementationPlan: string;
  backoutPlan: string;
  testPlan: string;
}

export const emptyPlan: ChangePlanValues = {
  changeType: 'normal',
  risk: 'medium',
  reason: '',
  plannedStart: '',
  plannedEnd: '',
  implementationPlan: '',
  backoutPlan: '',
  testPlan: '',
};

/** The window ends after it starts (both optional while drafting). */
export const windowInvalid = (v: Pick<ChangePlanValues, 'plannedStart' | 'plannedEnd'>) =>
  Boolean(v.plannedStart && v.plannedEnd && v.plannedEnd <= v.plannedStart);

export type ChangePlanPart = 'classification' | 'reason' | 'window' | 'plans';
const ALL_PARTS: readonly ChangePlanPart[] = ['classification', 'reason', 'window', 'plans'];

const asDateTime = (v: string) => (v ? (v as ISODateTimeString) : undefined);

/**
 * Type, risk, reason, planned window and the implementation / backout / test plans (`parts` picks some, in this
 * order). `windowRequired`: the window is needed now (submitting) — empty fields are errors.
 */
export function ChangePlanFields({
  value,
  onChange,
  showErrors,
  parts = ALL_PARTS,
  windowRequired,
}: {
  value: ChangePlanValues;
  onChange: (v: ChangePlanValues) => void;
  showErrors?: boolean;
  parts?: readonly ChangePlanPart[];
  windowRequired?: boolean;
}) {
  const t = useTranslations('itsm');
  const tp = useTranslations('itsm.changePlan');
  const set = <K extends keyof ChangePlanValues>(k: K, v: ChangePlanValues[K]) =>
    onChange({ ...value, [k]: v });
  const badWindow = showErrors && windowInvalid(value);
  const missingStart = showErrors && windowRequired && !value.plannedStart;
  const missingEnd = showErrors && windowRequired && !value.plannedEnd;
  return (
    <FormLayout defaultOptionality="optional">
      {parts.includes('classification') && (
        <VStack gap={2}>
          <Grid columns={{ minWidth: 220 }} gap={3}>
            <Selector
              label={tp('changeType')}
              width="100%"
              value={value.changeType}
              onChange={(v) => set('changeType', v as ChangeType)}
              options={changeTypeSchema.options.map((c) => ({ value: c, label: t(`changeType.${c}`) }))}
            />
            <Selector
              label={tp('risk')}
              width="100%"
              value={value.risk}
              onChange={(v) => set('risk', v as Risk)}
              options={riskSchema.options.map((r) => ({ value: r, label: t(`risk.${r}`) }))}
            />
          </Grid>
          <Text type="supporting">{tp(`typeHint.${value.changeType}`)}</Text>
        </VStack>
      )}
      {parts.includes('reason') && (
        <TextArea
          label={tp('reason')}
          rows={2}
          value={value.reason}
          onChange={(reason) => set('reason', reason)}
        />
      )}
      {parts.includes('window') && (
        <VStack gap={2}>
          <Text type="label">{tp('window')}</Text>
          <Grid columns={{ minWidth: 220 }} gap={3}>
            <DateTimeInput
              label={tp('start')}
              isRequired={windowRequired}
              hourFormat="24h"
              hasClear
              value={asDateTime(value.plannedStart)}
              onChange={(v) => set('plannedStart', v ?? '')}
              status={missingStart ? { type: 'error', message: tp('windowRequired') } : undefined}
            />
            <DateTimeInput
              label={tp('end')}
              isRequired={windowRequired}
              hourFormat="24h"
              hasClear
              value={asDateTime(value.plannedEnd)}
              min={asDateTime(value.plannedStart)}
              onChange={(v) => set('plannedEnd', v ?? '')}
              status={
                badWindow || missingEnd
                  ? { type: 'error', message: badWindow ? tp('endBeforeStart') : tp('windowRequired') }
                  : undefined
              }
            />
          </Grid>
        </VStack>
      )}
      {parts.includes('plans') &&
        (['implementationPlan', 'backoutPlan', 'testPlan'] as const).map((k) => (
          <TextArea key={k} label={tp(k)} rows={3} value={value[k]} onChange={(v) => set(k, v)} />
        ))}
    </FormLayout>
  );
}

/** Live check for other changes touching the same CIs in an overlapping window. */
export function ConflictCheck({
  plannedStart,
  plannedEnd,
  ciIds,
  exclude,
}: {
  plannedStart: string;
  plannedEnd: string;
  ciIds: string[];
  exclude?: string;
}) {
  const t = useTranslations('itsm.changePlan.conflicts');
  const format = useFormatter();
  const [query, setQuery] = useState<{ start: string; end: string; ciIds: string } | null>(null);
  const ciKey = ciIds.join(',');
  // Debounced so typing a date doesn't fire a request per keystroke.
  useEffect(() => {
    const start = fromLocalInput(plannedStart);
    const end = fromLocalInput(plannedEnd);
    const h = setTimeout(
      () => setQuery(start && end && end > start && ciKey ? { start, end, ciIds: ciKey } : null),
      400,
    );
    return () => clearTimeout(h);
  }, [plannedStart, plannedEnd, ciKey]);
  const { data, isFetching } = useApiQuery<{ items: ChangeConflict[] }>(
    query ? '/itsm/changes/conflicts' : null,
    query ? { ...query, exclude } : undefined,
  );
  if (!query) return null;
  const items = data?.items ?? [];
  return (
    <div aria-live="polite" aria-busy={isFetching || undefined}>
      {!data ? null : items.length ? (
        <Banner status="warning" title={t('found', { count: items.length })} collapsible={false}>
          <ul className="grid gap-1.5">
            {items.map((c) => (
              <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={ticketHref(c.reference)}
                  className="font-mono text-xs font-medium hover:underline"
                >
                  {c.reference}
                </Link>
                <span className="min-w-0 truncate">{c.title}</span>
                <TicketStatusBadge status={c.status} />
                <Text as="div" type="supporting" size="xsm">
                  {format.dateTimeRange(new Date(c.plannedStart), new Date(c.plannedEnd), {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {t('shared', { cis: c.sharedCis.map((s) => s.name).join(', ') })}
                </Text>
              </li>
            ))}
          </ul>
        </Banner>
      ) : (
        <HStack gap={2} vAlign="center">
          <Icon icon={CheckCircle2Icon} color="success" />
          <Text color="secondary">{t('none')}</Text>
        </HStack>
      )}
    </div>
  );
}
