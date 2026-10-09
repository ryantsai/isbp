'use client';

import type { RepeatApproverPolicy, WorkflowGraph } from '@isbp/sdk';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
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
  const id = useId();
  const value: RepeatApproverPolicy = editor.draft.repeatApprovers === 'skip' ? 'skip' : 'ask';
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-policy`}>{t('title')}</Label>
      <Select
        value={value}
        onValueChange={(v) => editor.edit(withRepeatApprovers(editor.draft, v === 'skip' ? 'skip' : 'ask'))}
      >
        <SelectTrigger
          id={`${id}-policy`}
          className="w-full"
          disabled={editor.readOnly}
          aria-describedby={`${id}-hint`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ask">{t('ask')}</SelectItem>
          <SelectItem value="skip">{t('skip')}</SelectItem>
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t('hint')}
      </p>
    </div>
  );
}
