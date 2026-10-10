'use client';

import type {
  FormDetail,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowTrigger,
} from '@isbp/contracts';
import { type FieldDef, localize, newStepId, type WorkflowGraph } from '@isbp/sdk';
import { useApi, useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { FadeIn } from '@isbp/ui/motion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { IconTile } from '@isbp/ui/icon-tile';
import {
  ArrowUpRightIcon,
  InfoIcon,
  LockIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  WorkflowIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { invalidatePaths, useErrorText } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { RepeatApproversField } from '@/components/workflows/repeat-approvers-field';
import { FORM_TRIGGER } from '@/components/workflows/workflow-labels';
import {
  autoStepName,
  useWorkflowName,
  WorkflowCanvas,
  type WorkflowEditor,
} from '@/components/workflows/workflow-editor';

const NO_APPROVAL = '__none__';

/** A first approval for a new process: the requester's manager, or their department head when they have none. */
export function starterApproval(): WorkflowGraph {
  return {
    steps: [
      {
        id: newStepId(),
        type: 'approval',
        name: autoStepName('manager'),
        approvers: [{ type: 'manager', level: 1, fallback: { type: 'department-head' } }],
        mode: 'any',
        ifNoApprover: 'reject',
      },
    ],
  };
}

/**
 * The form builder's Approval tab: who approves requests made with this form, built here on the workflow canvas
 * (one workflow per form, preset to this form's answers) and published with the form. An existing approval workflow
 * can be used instead, and "No approval" lets requests go ahead as soon as they're sent.
 */
export function FormApproval({
  form,
  name,
  fields,
  workflowId,
  editor,
  loading,
  trigger,
  workflows,
  pendingLink,
  readOnly,
  checks,
  focusStep,
  onLink,
}: {
  form: FormDetail;
  /** The form's name as shown now (for the new approval's name). */
  name: string;
  fields: readonly FieldDef[];
  workflowId: string | null;
  editor: WorkflowEditor | null;
  loading: boolean;
  trigger: WorkflowTrigger | undefined;
  /** Approval workflows for forms (any state). */
  workflows: WorkflowDefinitionSummary[];
  /** The form is live and the approval isn't published yet: it takes effect with the next publish. */
  pendingLink: boolean;
  readOnly: boolean;
  checks: ReactNode;
  /** Select this step (a "before you publish" fix points at it). */
  focusStep?: { id: string; at: number } | null;
  onLink: (id: string | null) => void;
}) {
  const t = useTranslations('forms.approval');
  const locale = useLocale();
  const api = useApi();
  const client = useQueryClient();
  const errorText = useErrorText();
  const display = useWorkflowName();
  const uid = useId();
  const canRead = useCan('core.workflows.read');
  const canManage = useCan('core.workflows.manage');
  const [creating, setCreating] = useState(false);

  const usable = workflows.filter((w) => !w.archived && (w.publishedVersion !== null || w.id === workflowId));
  const def = editor?.def;
  const sharedWith = def ? def.usedBy.forms.filter((f) => f.id !== form.id) : [];

  const create = async () => {
    setCreating(true);
    try {
      const created = await api.post<WorkflowDefinition>('/workflows', {
        triggerKey: FORM_TRIGGER,
        name: t('defaultName', { name }),
      });
      await api.patch<WorkflowDefinition>(`/workflows/${created.id}`, {
        draft: starterApproval(),
      });
      await invalidatePaths(client, ['/workflows']);
      onLink(created.id);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const picker = (
    <div className="grid gap-1.5">
      <Label htmlFor={`${uid}-pick`} className="text-xs font-normal text-muted-foreground">
        {workflowId ? t('change') : t('useExisting')}
      </Label>
      <Select
        value={workflowId ?? NO_APPROVAL}
        onValueChange={(v) => onLink(v === NO_APPROVAL ? null : v)}
        disabled={readOnly}
      >
        <SelectTrigger id={`${uid}-pick`} className="w-full sm:w-72">
          <SelectValue placeholder={t('pick')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_APPROVAL}>{t('none')}</SelectItem>
          <SelectSeparator />
          {workflowId && !usable.some((w) => w.id === workflowId) && (
            <SelectItem value={workflowId}>{editor?.name || t('pick')}</SelectItem>
          )}
          {usable.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {display(w.name)}
              {w.publishedVersion === null && (
                <Badge variant="muted" className="ml-1">
                  {t('notPublished')}
                </Badge>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (!canRead)
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LockIcon className="size-4" aria-hidden /> {t('title')}
          </CardTitle>
          <CardDescription>
            {form.workflow ? t('noAccessNamed', { name: display(form.workflow.name) }) : t('noAccess')}
          </CardDescription>
        </CardHeader>
      </Card>
    );

  if (!workflowId)
    return (
      <FadeIn>
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader className="flex items-start gap-3">
            <IconTile aria-hidden>
              <UserCheckIcon className="size-5" aria-hidden />
            </IconTile>
            <div className="grid gap-1">
              <CardTitle className="text-base">
                <h2>{t('emptyTitle')}</h2>
              </CardTitle>
              <CardDescription>{t('emptyDescription')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            {canManage && !readOnly && (
              <div className="grid gap-1.5 justify-items-start">
                <Button onClick={() => void create()} loading={creating}>
                  <WorkflowIcon /> {t('setUp')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('setUpHint')}</p>
              </div>
            )}
            {usable.length > 0 && picker}
          </CardContent>
        </Card>
      </FadeIn>
    );

  if (loading || !editor)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    );

  const status =
    editor.def.publishedVersion === null
      ? t('statusNew')
      : editor.unpublished
        ? t('statusChanged', { version: editor.def.publishedVersion })
        : t('statusLive', { version: editor.def.publishedVersion });

  return (
    <FadeIn className="grid gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-5 grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <WorkflowIcon className="size-4" aria-hidden />
          </span>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Label htmlFor={`${uid}-name`} className="text-xs font-normal text-muted-foreground">
              {t('name')}
            </Label>
            <Input
              id={`${uid}-name`}
              value={editor.name}
              disabled={editor.readOnly || readOnly}
              onChange={(e) => editor.setName(e.target.value)}
              className="h-8 max-w-md font-medium"
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {status}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {picker}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/workflows/${workflowId}`}>
              <ArrowUpRightIcon /> {t('openDesigner')}
            </Link>
          </Button>
        </div>
      </div>

      {sharedWith.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2 text-sm text-info">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('shared', {
            count: sharedWith.length,
            names: sharedWith.map((f) => localize(f.name, locale) || f.key).join(', '),
          })}
        </p>
      )}
      {pendingLink && (
        <p className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2 text-sm text-info">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('pendingLink')}
        </p>
      )}
      {editor.readOnly && !editor.def.archived && (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('readOnly')}
        </p>
      )}
      {editor.def.archived && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('archived')}
        </p>
      )}
      {checks}

      <WorkflowCanvas
        editor={editor}
        trigger={trigger}
        fields={fields}
        known={{ form: { key: form.key, category: form.category } }}
        settings={<RepeatApproversField editor={editor} />}
        initialSelection={focusStep?.id ?? editor.draft.steps[0]?.id ?? null}
        focus={focusStep}
      />
    </FadeIn>
  );
}
