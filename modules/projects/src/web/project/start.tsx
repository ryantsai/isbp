'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useApiMutation } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ProjectDetail } from '../../contracts';
import { INVALIDATE, projectApi } from '../lib';

/** Starting a proposal: either it starts at once, or (over the threshold) it goes for approval. */
export function useStartProject(project: ProjectDetail) {
  const t = useTranslations('projects.project');
  const tc = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const start = useApiMutation((api) => api.post<ProjectDetail>(`${projectApi(project.key)}/start`), {
    invalidate: INVALIDATE,
    success: (p) => (p.status === 'active' ? t('started') : t('submitted')),
    onSuccess: () => setConfirming(false),
  });
  const needsApproval =
    project.budgetHours !== null && project.budgetHours > project.settings.proposalThresholdHours;
  const label = needsApproval ? t('submitForApproval') : t('start');
  const dialog = (
    <AlertDialog
      isOpen={confirming}
      onOpenChange={setConfirming}
      title={needsApproval ? t('submitTitle', { key: project.key }) : t('startTitle', { key: project.key })}
      description={
        needsApproval
          ? t('startNeedsApproval', {
              hours: project.budgetHours ?? 0,
              threshold: project.settings.proposalThresholdHours,
            })
          : t('startAutomatic', { threshold: project.settings.proposalThresholdHours })
      }
      actionLabel={label}
      actionVariant="primary"
      cancelLabel={tc('cancel')}
      isActionLoading={start.isPending}
      onAction={() => start.mutate(undefined)}
    />
  );
  return { label, needsApproval, open: () => setConfirming(true), dialog };
}
