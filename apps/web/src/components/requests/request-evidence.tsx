'use client';

import type { FormSubmission, RecordPanelSlotProps } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { Slot, useSlot } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { useLocale, useTranslations } from 'next-intl';
import { DecisionValues } from '../workflows/decision-values';
import { StatusBadge } from '../workflows/status-badges';

/**
 * "Filled in by approvers": each decision whose step asked its approver for fields (evaluation result, handling notes,
 * completion date…), with the values in the reader's language — the "filled in by IT" part of a paper form.
 */
export function RequestDecisions({ submission }: { submission: FormSubmission }) {
  const t = useTranslations('requests.detail.decisions');
  const locale = useLocale();
  const decisions = submission.decisions.filter((d) => d.fields.length > 0 && Object.keys(d.data).length > 0);
  if (!decisions.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-5">
          {decisions.map((d) => (
            <li key={d.taskId} className="grid min-w-0 gap-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{localize(d.step, locale)}</span>
                <StatusBadge status={d.status} kind="task" />
                <span className="text-muted-foreground">
                  {d.decidedBy
                    ? t('decidedBy', { name: d.decidedBy.displayName })
                    : t('decidedAutomatically')}
                  {d.decidedAt && (
                    <>
                      {' · '}
                      <DateTime date={d.decidedAt} />
                    </>
                  )}
                </span>
              </div>
              <DecisionValues fields={d.fields} data={d.data} people={submission.people} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * Evidence and related records of a request (`core.request`): the platform's attachments and links panels, so files
 * go through the policy, malware scanning and audit like on any record. Who may add them comes from the request
 * rules (`editable`: the requester and its approvers until it is withdrawn, and form administrators).
 */
export function RequestEvidence({ submissionId }: { submissionId: string }) {
  const links = useSlot('core.record.links');
  const files = useSlot('core.record.files');
  if (!links.length && !files.length) return null;
  const props: RecordPanelSlotProps = { record: { type: 'core.request', id: submissionId } };
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <Slot
          name="core.record.files"
          props={props}
          fallback={<Skeleton className="h-40 w-full rounded-xl" />}
        />
      </div>
      <div className="min-w-0">
        <Slot
          name="core.record.links"
          props={props}
          fallback={<Skeleton className="h-40 w-full rounded-xl" />}
        />
      </div>
    </div>
  );
}
