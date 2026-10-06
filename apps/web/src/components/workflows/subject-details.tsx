'use client';

import type { FormSubmission, PersonRef, WorkflowInstance } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { FormAnswers } from '@isbp/ui/form-renderer';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowUpRightIcon, KeyRoundIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useApiQuery } from '@/lib/api';

const RISK: Record<string, { icon: ReactNode; variant: 'muted' | 'warning' | 'destructive' }> = {
  low: { icon: <ShieldCheckIcon aria-hidden />, variant: 'muted' },
  medium: { icon: <ShieldIcon aria-hidden />, variant: 'warning' },
  high: { icon: <ShieldAlertIcon aria-hidden />, variant: 'destructive' },
};

export function RiskBadge({ level }: { level: string }) {
  const t = useTranslations('requests.risk');
  const r = RISK[level] ?? RISK.low!;
  return (
    <Badge variant={r.variant}>
      {r.icon}
      {t.has(level) ? t(level) : level}
    </Badge>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export function Person({ person }: { person: PersonRef | null | undefined }) {
  if (!person) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <UserAvatar name={person.displayName} src={person.avatarUrl} className="size-5 text-[9px]" />
      {person.displayName}
    </span>
  );
}

interface AccessFacts {
  role?: { name?: string; application?: string; riskLevel?: string };
  request?: { durationDays?: number | null; permanent?: boolean; justification?: string };
}

function AccessRequestFacts({ instance }: { instance: WorkflowInstance }) {
  const t = useTranslations('requests.detail');
  const facts = instance.facts as AccessFacts;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <Field label={t('role')}>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <KeyRoundIcon className="size-3.5 text-muted-foreground" aria-hidden />
          {facts.role?.name}
        </span>
        {facts.role?.application && facts.role.application !== 'isbp' && (
          <span className="ml-1.5 font-mono text-xs text-muted-foreground">{facts.role.application}</span>
        )}
      </Field>
      <Field label={t('risk')}>
        <RiskBadge level={facts.role?.riskLevel ?? 'low'} />
      </Field>
      <Field label={t('for')}>
        <Person person={instance.subjectUser} />
      </Field>
      <Field label={t('duration')}>
        {facts.request?.permanent || !facts.request?.durationDays
          ? t('permanent')
          : t('days', { count: facts.request.durationDays })}
      </Field>
      {facts.request?.justification && (
        <Field label={t('justification')} wide>
          <p className="rounded-lg bg-muted/50 px-3 py-2 whitespace-pre-line">
            {facts.request.justification}
          </p>
        </Field>
      )}
    </dl>
  );
}

function FormSubmissionFacts({ id }: { id: string }) {
  const { data } = useApiQuery<FormSubmission>(`/form-submissions/${id}`);
  if (!data) return <Skeleton className="h-24 w-full" />;
  return <FormAnswers elements={data.schema.elements} data={data.data} people={data.people} />;
}

/** What is being decided: access-request facts, form answers, or a link to the module's page. */
export function SubjectDetails({ instance }: { instance: WorkflowInstance }) {
  const t = useTranslations('requests.detail');
  const locale = useLocale();
  if (instance.subject.type === 'access-request') return <AccessRequestFacts instance={instance} />;
  if (instance.subject.type === 'form-submission') return <FormSubmissionFacts id={instance.subject.id} />;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <span className="text-sm font-medium">{localize(instance.subject.label, locale)}</span>
      {instance.subject.href && (
        <Button asChild size="sm" variant="outline">
          <Link href={instance.subject.href}>
            {t('open')}
            <ArrowUpRightIcon />
          </Link>
        </Button>
      )}
    </div>
  );
}
