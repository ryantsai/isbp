'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { UserAvatar } from '@isbp/ui/avatar';
import { Markdown } from '@isbp/ui/markdown';
import { RelativeTime } from '@isbp/ui/relative-time';
import { PencilIcon, SparklesIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ProjectSignalsDto, StatusUpdate } from '../../contracts';
import { HealthBadge, StandingBadge } from '../components/badges';
import { dateValue } from '../lib';

/** "27 open tasks · 2 overdue · next milestone Rollout HQ (Nov 21)": the plan when the update was sent. */
export function SignalsLine({ signals }: { signals: ProjectSignalsDto }) {
  const t = useTranslations('projects.updates.signals');
  const format = useFormatter();
  const parts = [
    t('open', { count: signals.openTasks }),
    signals.overdueTasks ? t('overdue', { count: signals.overdueTasks }) : null,
    signals.blockedTasks ? t('blocked', { count: signals.blockedTasks }) : null,
    signals.overdueMilestones ? t('milestonesOverdue', { count: signals.overdueMilestones }) : null,
    signals.nextMilestone
      ? signals.nextMilestone.dueDate
        ? t('nextMilestone', {
            name: signals.nextMilestone.name,
            date: format.dateTime(dateValue(signals.nextMilestone.dueDate), {
              month: 'short',
              day: 'numeric',
            }),
          })
        : t('nextMilestoneUndated', { name: signals.nextMilestone.name })
      : null,
  ].filter(Boolean);
  return <Text type="supporting">{parts.join(' · ')}</Text>;
}

const SECTIONS = ['done', 'next', 'blockers', 'asks'] as const;

/** One sent status update: who, when, the status, the summary and the done / next / blockers / asks sections. */
export function UpdateCard({
  update,
  onEdit,
  headingLevel = 3,
}: {
  update: StatusUpdate;
  onEdit?: () => void;
  headingLevel?: 3 | 4;
}) {
  const t = useTranslations('projects.updates');
  const format = useFormatter();
  const name = update.author?.displayName ?? t('someone');
  return (
    <article className="grid min-w-0 gap-3" aria-label={t('byAuthor', { name })}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <UserAvatar name={name} src={update.author?.avatarUrl} className="size-7 text-[11px]" />
        <VStack gap={0} className="min-w-0 grow">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={headingLevel}>{name}</Heading>
            {update.byManager && <Badge variant="neutral" label={t('manager')} />}
          </HStack>
          <Text type="supporting">
            {update.submittedAt ? <RelativeTime date={update.submittedAt} /> : null}
            {update.editedAt ? ` · ${t('edited')}` : ''}
          </Text>
        </VStack>
        {update.status && <HealthBadge health={update.status} />}
        {update.standing === 'late' && <StandingBadge standing="late" />}
        {onEdit && update.canEdit && (
          <Button
            label={t('edit')}
            aria-label={t('editYours')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={PencilIcon} />}
            onClick={onEdit}
          />
        )}
      </HStack>
      {update.summary && (
        <span className="wrap-anywhere">
          <Text>{update.summary}</Text>
        </span>
      )}
      {(update.progress !== null || update.forecastDate) && (
        <HStack gap={3} wrap="wrap">
          {update.progress !== null && (
            <Text type="supporting">{t('progressValue', { progress: update.progress })}</Text>
          )}
          {update.forecastDate && (
            <Text type="supporting">
              {t('forecastValue', {
                date: format.dateTime(dateValue(update.forecastDate), { dateStyle: 'medium' }),
              })}
            </Text>
          )}
        </HStack>
      )}
      {SECTIONS.filter((s) => update[s]).map((s) => (
        <section key={s} className="grid min-w-0 gap-1">
          <Text type="label">{t(`fields.${s}`)}</Text>
          <div className="min-w-0 wrap-anywhere">
            <Markdown>{update[s]!}</Markdown>
          </div>
        </section>
      ))}
      <HStack gap={2} vAlign="center" wrap="wrap">
        {update.signals && <SignalsLine signals={update.signals} />}
        {update.draftMode && (
          <HStack as="span" gap={1} vAlign="center">
            <Icon icon={SparklesIcon} size="xsm" color="secondary" />
            <Text type="supporting">{update.draftMode === 'llm' ? t('draftedAi') : t('draftedBuiltin')}</Text>
          </HStack>
        )}
      </HStack>
    </article>
  );
}
