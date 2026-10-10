'use client';

import type { FormDetail, WorkflowDefinition, WorkflowTrigger } from '@isbp/contracts';
import { formFields, localize } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Textarea } from '@isbp/ui/textarea';
import { cn } from '@isbp/ui';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  MoreHorizontalIcon,
  RocketIcon,
  SaveIcon,
  StarIcon,
  StarOffIcon,
  UndoIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useCan } from '@isbp/sdk/web';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { RepeatApproversField } from './repeat-approvers-field';
import { FORM_TRIGGER } from './workflow-labels';
import {
  useWorkflowEditor,
  useWorkflowName,
  useWorkflowStatus,
  WorkflowCanvas,
  type WorkflowEditor,
  WorkflowEditorError,
} from './workflow-editor';

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
        <div className="grid gap-1.5">
          <Label htmlFor="wf-name">{t('name')}</Label>
          <Input id="wf-name" value={editor.name} onChange={(e) => editor.setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="wf-desc">{t('description')}</Label>
          <Textarea
            id="wf-desc"
            rows={3}
            value={editor.description}
            onChange={(e) => editor.setDescription(e.target.value)}
          />
        </div>
        <RepeatApproversField editor={editor} />
        {trigger && (
          <div className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm">
            <span className="font-medium">{tr.has(trigger.name) ? tr(trigger.name) : trigger.name}</span>
            {trigger.description && (
              <span className="text-muted-foreground">
                {tr.has(trigger.description) ? tr(trigger.description) : trigger.description}
              </span>
            )}
          </div>
        )}
        {def.triggerKey === FORM_TRIGGER && !def.usedBy.forms.length && (
          <div className="grid gap-1.5">
            <Label htmlFor="wf-form">{t('factsFromForm')}</Label>
            <Select value={formId ?? undefined} onValueChange={onFormId}>
              <SelectTrigger id="wf-form" className="w-full">
                <SelectValue placeholder={t('pickForm')} />
              </SelectTrigger>
              <SelectContent>
                {(forms.data?.items ?? []).map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name[locale] ?? f.name.en ?? f.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('factsFromFormHint')}</p>
          </div>
        )}
      </fieldset>
      <div className="mt-5 grid gap-2 text-sm">
        <h3 className="font-semibold">{t('usedBy')}</h3>
        {!def.usedBy.forms.length && !def.usedBy.roles.length ? (
          <p className="text-muted-foreground">
            {def.isDefault && def.triggerKey !== FORM_TRIGGER ? t('usedByDefault') : t('usedByNothing')}
          </p>
        ) : (
          <ul className="grid gap-1">
            {def.usedBy.forms.map((f) => (
              <li key={f.id}>
                <Link className="text-primary hover:underline" href={`/admin/forms/${f.id}?tab=approval`}>
                  {localize(f.name, locale) || f.key}
                </Link>
              </li>
            ))}
            {def.usedBy.roles.map((r) => (
              <li key={r.id}>
                <Link className="text-primary hover:underline" href={`/admin/roles/${r.id}`}>
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {def.triggerKey === FORM_TRIGGER && def.usedBy.forms.length > 0 && (
          <p className="text-xs text-muted-foreground">{t('editInForm')}</p>
        )}
      </div>
      <div className="mt-5 grid gap-2 text-sm">
        <h3 className="font-semibold">{t('versions')}</h3>
        {!def.versions.length ? (
          <p className="text-muted-foreground">{t('noVersions')}</p>
        ) : (
          <ol className="grid gap-1.5">
            {def.versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-2">
                <span className={cn('font-medium', v.version === def.publishedVersion && 'text-success')}>
                  {t('version', { version: v.version })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {v.publishedBy?.displayName ?? t('system')} · <RelativeTime date={v.publishedAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {canAudit && (
        <div className="mt-5 grid gap-2 text-sm">
          <h3 className="font-semibold">{t('activity')}</h3>
          <ActivityFeed subject={{ type: 'workflow', id: def.id }} description={t('activityDescription')} />
        </div>
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
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <Link
            href="/admin/workflows"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            {t('back')}
          </Link>
          <h1 className="text-xl font-semibold tracking-tight wrap-anywhere">{name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{trigger ? (tr.has(trigger.name) ? tr(trigger.name) : trigger.name) : def.triggerKey}</span>
            <motion.span
              key={def.publishedVersion ?? 'draft'}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <Badge variant={def.publishedVersion ? 'success' : 'muted'}>{status.version}</Badge>
            </motion.span>
            {def.isDefault && !isForm && (
              <Badge variant="info">
                <StarIcon aria-hidden />
                {t('default')}
              </Badge>
            )}
            {status.changed && <Badge variant="warning">{t('unpublished')}</Badge>}
            {def.archived && (
              <Badge variant="muted">
                <ArchiveIcon aria-hidden />
                {t('archived')}
              </Badge>
            )}
            <span aria-live="polite">
              <AnimatePresence initial={false}>
                {editor.dirty && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="font-medium text-warning-foreground"
                  >
                    {t('unsaved')}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </div>
        </div>
        {editor.canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {!def.archived && (
              <>
                <Button
                  variant="outline"
                  onClick={() => void run('save')}
                  disabled={!editor.dirty || editor.busy !== null}
                  loading={editor.busy === 'saving'}
                >
                  <SaveIcon />
                  {t('save')}
                </Button>
                <Button
                  onClick={() => void run('publish')}
                  disabled={editor.busy !== null || !editor.unpublished}
                  loading={editor.busy === 'publishing'}
                >
                  <RocketIcon />
                  {t('publish')}
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('more')}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Forms use the workflow they name: a default means nothing for them. */}
                {!isForm && !def.isDefault && def.publishedVersion !== null && !def.archived && (
                  <DropdownMenuItem onSelect={() => action.mutate(`/workflows/${def.id}/default`)}>
                    <StarIcon />
                    {t('makeDefault')}
                  </DropdownMenuItem>
                )}
                {!isForm && def.isDefault && !trigger?.required && (
                  <DropdownMenuItem onSelect={() => clearDefault.mutate(undefined)}>
                    <StarOffIcon />
                    {t('clearDefault')}
                  </DropdownMenuItem>
                )}
                {def.archived ? (
                  <DropdownMenuItem onSelect={() => action.mutate(`/workflows/${def.id}/restore`)}>
                    <UndoIcon />
                    {t('restore')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('archive')}>
                    <ArchiveIcon />
                    {t('archive')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {editor.globalIssues.length > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <AlertTriangleIcon className="size-4 text-warning-foreground" aria-hidden />
          {editor.globalIssues.map((i) => (ti.has(i.code) ? ti(i.code) : i.code)).join(' ')}
        </div>
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
    </div>
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
