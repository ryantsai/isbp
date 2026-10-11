'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { FormSubmission, PersonRef, WorkflowInstance } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { FormAnswers } from '@isbp/ui/form-renderer';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowUpRightIcon,
  KeyRoundIcon,
  type LucideIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useApiQuery } from '@/lib/api';

const RISK: Record<string, { icon: LucideIcon; variant: 'neutral' | 'warning' | 'error' }> = {
  low: { icon: ShieldCheckIcon, variant: 'neutral' },
  medium: { icon: ShieldIcon, variant: 'warning' },
  high: { icon: ShieldAlertIcon, variant: 'error' },
};

export function RiskBadge({ level }: { level: string }) {
  const t = useTranslations('requests.risk');
  const r = RISK[level] ?? RISK.low!;
  return (
    <Badge
      variant={r.variant}
      label={t.has(level) ? t(level) : level}
      icon={<Icon icon={r.icon} size="xsm" />}
    />
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt>
        <Text type="supporting" color="secondary" weight="medium">
          {label}
        </Text>
      </dt>
      <dd className="mt-0.5">
        <Text as="div">{children}</Text>
      </dd>
    </div>
  );
}

export function Person({ person }: { person: PersonRef | null | undefined }) {
  if (!person) return <Text color="secondary">—</Text>;
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
          <Icon icon={KeyRoundIcon} size="sm" color="secondary" />
          {facts.role?.name}
        </span>
        {facts.role?.application && facts.role.application !== 'isbp' && (
          <Text type="code" color="secondary" size="xsm" className="ml-1.5">
            {facts.role.application}
          </Text>
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
    <Card padding={3}>
      <HStack gap={3} hAlign="between" vAlign="center">
        <Text weight="medium">{localize(instance.subject.label, locale)}</Text>
        {instance.subject.href && (
          <Button
            label={t('open')}
            variant="secondary"
            size="sm"
            endContent={<Icon icon={ArrowUpRightIcon} />}
            href={instance.subject.href}
          />
        )}
      </HStack>
    </Card>
  );
}
