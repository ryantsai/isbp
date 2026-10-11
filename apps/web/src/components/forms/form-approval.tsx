'use client';

import type {
  FormDetail,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowTrigger,
} from '@isbp/contracts';
import { type FieldDef, localize, newStepId, type WorkflowGraph } from '@isbp/sdk';
import { useApi, useCan } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { IconTile } from '@isbp/ui/icon-tile';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { ArrowUpRightIcon, LockIcon, UserCheckIcon, WorkflowIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
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
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';

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
    <Selector
      label={workflowId ? t('change') : t('useExisting')}
      width={288}
      value={workflowId ?? NO_APPROVAL}
      onChange={(v) => onLink(v === NO_APPROVAL ? null : v)}
      isDisabled={readOnly}
      placeholder={t('pick')}
      options={[
        { value: NO_APPROVAL, label: t('none') },
        { type: 'divider' },
        ...(workflowId && !usable.some((w) => w.id === workflowId)
          ? [{ value: workflowId, label: editor?.name || t('pick') }]
          : []),
        ...usable.map((w) => ({
          value: w.id,
          label: display(w.name),
          description: w.publishedVersion === null ? t('notPublished') : undefined,
        })),
      ]}
    />
  );

  if (!canRead)
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>
            <HStack gap={2} vAlign="center">
              <Icon icon={LockIcon} />
              {t('title')}
            </HStack>
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
          <CardHeader>
            <HStack gap={3} vAlign="start">
              <IconTile aria-hidden>
                <UserCheckIcon />
              </IconTile>
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={2}>{t('emptyTitle')}</Heading>
                  <CardDescription>{t('emptyDescription')}</CardDescription>
                </VStack>
              </StackItem>
            </HStack>
          </CardHeader>
          <CardContent>
            <VStack gap={5} hAlign="start">
              {canManage && !readOnly && (
                <VStack gap={1.5} hAlign="start">
                  <Button
                    label={t('setUp')}
                    variant="primary"
                    icon={<Icon icon={WorkflowIcon} />}
                    isLoading={creating}
                    onClick={() => void create()}
                  />
                  <Text type="supporting">{t('setUpHint')}</Text>
                </VStack>
              )}
              {usable.length > 0 && picker}
            </VStack>
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
      <Card>
        <CardContent>
          <HStack gap={3} wrap="wrap" vAlign="end" hAlign="between">
            <StackItem size="fill">
              <VStack gap={1.5}>
                <TextInput
                  label={t('name')}
                  value={editor.name}
                  isDisabled={editor.readOnly || readOnly}
                  onChange={editor.setName}
                />
                <Text type="supporting" aria-live="polite">
                  {status}
                </Text>
              </VStack>
            </StackItem>
            <HStack gap={2} wrap="wrap" vAlign="end">
              {picker}
              <Button
                label={t('openDesigner')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowUpRightIcon} />}
                href={`/admin/workflows/${workflowId}`}
              />
            </HStack>
          </HStack>
        </CardContent>
      </Card>

      {sharedWith.length > 0 && (
        <Banner
          status="info"
          collapsible={false}
          title={t('shared', {
            count: sharedWith.length,
            names: sharedWith.map((f) => localize(f.name, locale) || f.key).join(', '),
          })}
        />
      )}
      {pendingLink && <Banner status="info" collapsible={false} title={t('pendingLink')} />}
      {editor.readOnly && !editor.def.archived && (
        <Banner status="info" collapsible={false} icon={<Icon icon={LockIcon} />} title={t('readOnly')} />
      )}
      {editor.def.archived && <Banner status="warning" collapsible={false} title={t('archived')} />}
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
