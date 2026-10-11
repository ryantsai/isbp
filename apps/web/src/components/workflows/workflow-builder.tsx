'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { FormDetail, WorkflowDefinition, WorkflowTrigger } from '@isbp/contracts';
import { formFields, localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DetailHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { ArchiveIcon, RocketIcon, SaveIcon, StarIcon, StarOffIcon, UndoIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { RepeatApproversField } from './repeat-approvers-field';
import {
  useWorkflowEditor,
  useWorkflowName,
  useWorkflowStatus,
  WorkflowCanvas,
  type WorkflowEditor,
  WorkflowEditorError,
} from './workflow-editor';
import { FORM_TRIGGER } from './workflow-labels';

/** The "Workflow" tab of the inspector: name, what it's for, the form whose answers it uses, where it's used, versions. */
function SettingsPanel({
  editor,
  trigger,
  formId,
  onFormId,
}: {
  editor: WorkflowEditor;
  trigger: WorkflowTrigger | undefined;
  formId: string | null;
  onFormId: (id: string) => void;
}) {
  const t = useTranslations('workflows.builder');
  const tr = useTranslations();
  const locale = useLocale();
  const canAudit = useCan('core.audit.read');
  const { def } = editor;
  const forms = useApiQuery<{ items: { id: string; key: string; name: Record<string, string> }[] }>(
    def.triggerKey === FORM_TRIGGER ? '/forms' : null,
  );
  return (
    <>
      <fieldset disabled={editor.readOnly} className="grid gap-5">
        <legend className="sr-only">{t('tabs.settings')}</legend>
        <TextInput label={t('name')} value={editor.name} onChange={editor.setName} />
        <TextArea
          label={t('description')}
          rows={3}
          value={editor.description}
          onChange={editor.setDescription}
        />
        <RepeatApproversField editor={editor} />
        {trigger && (
          <Card padding={3} variant="muted">
            <VStack gap={1}>
              <Text weight="medium">{tr.has(trigger.name) ? tr(trigger.name) : trigger.name}</Text>
              {trigger.description && (
                <Text color="secondary">
                  {tr.has(trigger.description) ? tr(trigger.description) : trigger.description}
                </Text>
              )}
            </VStack>
          </Card>
        )}
        {def.triggerKey === FORM_TRIGGER && !def.usedBy.forms.length && (
          <Selector
            label={t('factsFromForm')}
            description={t('factsFromFormHint')}
            placeholder={t('pickForm')}
            width="100%"
            hasSearch={(forms.data?.items.length ?? 0) > 12}
            value={formId ?? undefined}
            options={(forms.data?.items ?? []).map((f) => ({
              value: f.id,
              label: f.name[locale] ?? f.name.en ?? f.key,
            }))}
            onChange={onFormId}
          />
        )}
      </fieldset>
      <VStack gap={2} className="mt-5">
        <Heading level={3}>{t('usedBy')}</Heading>
        {!def.usedBy.forms.length && !def.usedBy.roles.length ? (
          <Text color="secondary">
            {def.isDefault && def.triggerKey !== FORM_TRIGGER ? t('usedByDefault') : t('usedByNothing')}
          </Text>
        ) : (
          <ul className="grid gap-1">
            {def.usedBy.forms.map((f) => (
              <li key={f.id}>
                <Link href={`/admin/forms/${f.id}?tab=approval`}>{localize(f.name, locale) || f.key}</Link>
              </li>
            ))}
            {def.usedBy.roles.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/roles/${r.id}`}>{r.name}</Link>
              </li>
            ))}
          </ul>
        )}
        {def.triggerKey === FORM_TRIGGER && def.usedBy.forms.length > 0 && (
          <Text type="supporting" color="secondary">
            {t('editInForm')}
          </Text>
        )}
      </VStack>
      <VStack gap={2} className="mt-5">
        <Heading level={3}>{t('versions')}</Heading>
        {!def.versions.length ? (
          <Text color="secondary">{t('noVersions')}</Text>
        ) : (
          <ol className="grid gap-1.5">
            {def.versions.map((v) => (
              <li key={v.version}>
                <HStack gap={2} vAlign="center" hAlign="between">
                  {v.version === def.publishedVersion ? (
                    <Badge variant="success" label={t('version', { version: v.version })} />
                  ) : (
                    <Text weight="medium">{t('version', { version: v.version })}</Text>
                  )}
                  <Text type="supporting" color="secondary">
                    {v.publishedBy?.displayName ?? t('system')} · <RelativeTime date={v.publishedAt} />
                  </Text>
                </HStack>
              </li>
            ))}
          </ol>
        )}
      </VStack>
      {canAudit && (
        <VStack gap={2} className="mt-5">
          <Heading level={3}>{t('activity')}</Heading>
          <ActivityFeed subject={{ type: 'workflow', id: def.id }} description={t('activityDescription')} />
        </VStack>
      )}
    </>
  );
}

function Editor({ def, trigger }: { def: WorkflowDefinition; trigger: WorkflowTrigger | undefined }) {
  const t = useTranslations('workflows.builder');
  const tr = useTranslations();
  const ti = useTranslations('workflows.issues');
  const display = useWorkflowName();
  const editor = useWorkflowEditor(def);
  const status = useWorkflowStatus(editor);
  const [confirm, setConfirm] = useState<'archive' | null>(null);
  // "Use the fields of": the form whose answers conditions and approvers can use (forms using it come first).
  const [formId, setFormId] = useState<string | null>(def.usedBy.forms[0]?.id ?? null);
  const form = useApiQuery<FormDetail>(def.triggerKey === FORM_TRIGGER && formId ? `/forms/${formId}` : null);
  const fields = useMemo(() => (form.data ? formFields(form.data.draft) : []), [form.data]);
  const isForm = def.triggerKey === FORM_TRIGGER;

  const action = useApiMutation((api, path: string) => api.post(path), {
    invalidate: ['/workflows', '/workflow-triggers'],
    onSuccess: () => setConfirm(null),
  });
  const clearDefault = useApiMutation((api) => api.delete(`/workflows/${def.id}/default`), {
    invalidate: ['/workflows', '/workflow-triggers'],
    success: t('defaultCleared', { name: trigger ? display(trigger.name) : def.triggerKey }),
  });

  const run = async (what: 'save' | 'publish') => {
    try {
      const r = what === 'save' ? await editor.save() : await editor.publish();
      toast.success(what === 'save' ? t('saved') : t('published', { version: r.publishedVersion ?? 1 }));
    } catch (err) {
      toast.error(err instanceof WorkflowEditorError ? err.message : String(err));
    }
  };

  const name = editor.name || display(def.name);
  // Forms use the workflow they name: a default means nothing for them.
  const menu = [
    ...(!isForm && !def.isDefault && def.publishedVersion !== null && !def.archived
      ? [
          {
            label: t('makeDefault'),
            icon: <Icon icon={StarIcon} />,
            onSelect: () => action.mutate(`/workflows/${def.id}/default`),
          },
        ]
      : []),
    ...(!isForm && def.isDefault && !trigger?.required
      ? [
          {
            label: t('clearDefault'),
            icon: <Icon icon={StarOffIcon} />,
            onSelect: () => clearDefault.mutate(undefined),
          },
        ]
      : []),
    ...(def.archived
      ? [
          {
            label: t('restore'),
            icon: <Icon icon={UndoIcon} />,
            onSelect: () => action.mutate(`/workflows/${def.id}/restore`),
          },
        ]
      : [
          {
            label: t('archive'),
            icon: <Icon icon={ArchiveIcon} />,
            destructive: true,
            onSelect: () => setConfirm('archive'),
          },
        ]),
  ];

  return (
    <VStack gap={4}>
      <DetailHeader
        back={{ href: '/admin/workflows', label: t('back') }}
        title={name}
        meta={trigger ? (tr.has(trigger.name) ? tr(trigger.name) : trigger.name) : def.triggerKey}
        status={
          <motion.span
            key={def.publishedVersion ?? 'draft'}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <Badge variant={def.publishedVersion ? 'success' : 'neutral'} label={status.version} />
          </motion.span>
        }
        badges={
          <>
            {def.isDefault && !isForm && (
              <Badge variant="info" label={t('default')} icon={<Icon icon={StarIcon} size="xsm" />} />
            )}
            {status.changed && <Badge variant="warning" label={t('unpublished')} />}
            {def.archived && (
              <Badge variant="neutral" label={t('archived')} icon={<Icon icon={ArchiveIcon} size="xsm" />} />
            )}
            <span aria-live="polite">
              <AnimatePresence initial={false}>
                {editor.dirty && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Badge variant="warning" label={t('unsaved')} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </>
        }
        menu={editor.canManage ? menu : []}
        primaryAction={
          editor.canManage && !def.archived ? (
            <Button
              label={t('publish')}
              variant="primary"
              icon={<Icon icon={RocketIcon} />}
              isLoading={editor.busy === 'publishing'}
              isDisabled={editor.busy !== null || !editor.unpublished}
              onClick={() => void run('publish')}
            />
          ) : undefined
        }
      >
        {editor.canManage && !def.archived && (
          <Button
            label={t('save')}
            variant="secondary"
            icon={<Icon icon={SaveIcon} />}
            isLoading={editor.busy === 'saving'}
            isDisabled={!editor.dirty || editor.busy !== null}
            onClick={() => void run('save')}
          />
        )}
      </DetailHeader>

      {editor.globalIssues.length > 0 && (
        <Banner
          status="warning"
          title={editor.globalIssues.map((i) => (ti.has(i.code) ? ti(i.code) : i.code)).join(' ')}
          collapsible={false}
        />
      )}

      <WorkflowCanvas
        editor={editor}
        trigger={trigger}
        fields={fields}
        known={form.data ? { form: { key: form.data.key, category: form.data.category } } : undefined}
        settings={<SettingsPanel editor={editor} trigger={trigger} formId={formId} onFormId={setFormId} />}
      />

      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => setConfirm(o ? 'archive' : null)}
        title={t('archiveTitle', { name })}
        description={
          def.usedBy.forms.length || def.usedBy.roles.length
            ? t('archiveBodyUsed', { count: def.usedBy.forms.length + def.usedBy.roles.length })
            : t('archiveBody')
        }
        confirmLabel={t('archive')}
        destructive
        loading={action.isPending}
        onConfirm={() => action.mutate(`/workflows/${def.id}/archive`)}
      />
    </VStack>
  );
}

/** Visual builder for one workflow definition. */
export function WorkflowBuilder({ id }: { id: string }) {
  const { data: def, isLoading } = useApiQuery<WorkflowDefinition>(`/workflows/${id}`);
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  if (isLoading || !def)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    );
  const trigger = triggers.data?.items.find((x) => x.key === def.triggerKey);
  return <Editor key={def.id} def={def} trigger={trigger} />;
}
