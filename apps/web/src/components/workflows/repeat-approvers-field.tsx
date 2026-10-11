'use client';

import { Selector } from '@astryxdesign/core/Selector';
import type { RepeatApproverPolicy, WorkflowGraph } from '@isbp/sdk';
import { useTranslations } from 'next-intl';
import type { WorkflowEditor } from './workflow-editor';

/** The graph with the policy set: `skip` is stored, `ask` (the default) is left out, so existing workflows don't change. */
export function withRepeatApprovers(graph: WorkflowGraph, policy: RepeatApproverPolicy): WorkflowGraph {
  const next: WorkflowGraph = { ...graph };
  if (policy === 'skip') next.repeatApprovers = 'skip';
  else delete next.repeatApprovers;
  return next;
}

/** "When someone already approved this request": the workflow's `repeatApprovers` setting (the Workflow tab). */
export function RepeatApproversField({
  editor,
}: {
  editor: Pick<WorkflowEditor, 'draft' | 'edit' | 'readOnly'>;
}) {
  const t = useTranslations('workflows.builder.repeatApprovers');
  const value: RepeatApproverPolicy = editor.draft.repeatApprovers === 'skip' ? 'skip' : 'ask';
  return (
    <Selector
      label={t('title')}
      width="100%"
      description={t('hint')}
      value={value}
      isDisabled={editor.readOnly}
      options={[
        { value: 'ask', label: t('ask') },
        { value: 'skip', label: t('skip') },
      ]}
      onChange={(v) => editor.edit(withRepeatApprovers(editor.draft, v === 'skip' ? 'skip' : 'ask'))}
    />
  );
}
