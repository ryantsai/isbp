'use client';

import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { cn } from '@isbp/ui';
import { useApiMutation } from '@isbp/ui/query';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ProjectDetail } from '../../contracts';
import { toIsoDate } from '../components/inputs';
import { INVALIDATE, projectApi } from '../lib';

/**
 * Name + due date → "Add milestone", where people look (the overview's Milestones card and Settings). The button
 * stays enabled; an empty name is explained on submit.
 */
export function AddMilestoneForm({
  project,
  onAdded,
  autoFocus,
  className,
}: {
  project: ProjectDetail;
  onAdded?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useTranslations('projects.settings.milestones');
  const [name, setName] = useState('');
  const [due, setDue] = useState('');
  const [missing, setMissing] = useState(false);
  // Bumped after a milestone is added so the name field remounts and takes the focus back.
  const [round, setRound] = useState(0);
  const create = useApiMutation(
    (api, body: { name: string; dueDate: string | null }) =>
      api.post(`${projectApi(project.key)}/milestones`, body),
    {
      invalidate: INVALIDATE,
      success: t('created'),
      onSuccess: () => {
        setName('');
        setDue('');
        setRound((r) => r + 1);
        onAdded?.();
      },
    },
  );
  return (
    <form
      noValidate
      className={cn(className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setMissing(true);
          return;
        }
        create.mutate({ name: name.trim(), dueDate: due || null });
      }}
    >
      <FormLayout defaultOptionality="optional">
        <HStack gap={3} wrap="wrap" vAlign="end">
          <StackItem size="fill" className="min-w-48">
            <TextInput
              key={round}
              label={t('name')}
              hasAutoFocus={autoFocus || round > 0}
              value={name}
              status={missing ? { type: 'error', message: t('nameRequired') } : undefined}
              onChange={(v) => {
                const next = v.slice(0, 200);
                setName(next);
                if (next.trim()) setMissing(false);
              }}
            />
          </StackItem>
          <DateInput
            label={t('due')}
            hasClear
            width={176}
            value={toIsoDate(due)}
            onChange={(v) => setDue(v ?? '')}
          />
          <Button
            label={t('add')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            isLoading={create.isPending}
            type="submit"
          />
        </HStack>
      </FormLayout>
    </form>
  );
}
