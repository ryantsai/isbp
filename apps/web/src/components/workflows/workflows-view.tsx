'use client';

import type {
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowInstanceSummary,
  WorkflowTrigger,
} from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArchiveIcon,
  ChevronRightIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  StarIcon,
  WorkflowIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { InstanceSheet } from '../approvals/instance-sheet';
import { StatusBadge } from './status-badges';

function useLabel() {
  const t = useTranslations();
  return (s: string) => (t.has(s) ? t(s) : s);
}

function NewWorkflowDialog({
  open,
  onOpenChange,
  triggers,
  definitions,
  initialTrigger,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  triggers: WorkflowTrigger[];
  definitions: WorkflowDefinitionSummary[];
  initialTrigger: string | null;
}) {
  const t = useTranslations('workflows.list.create');
  const label = useLabel();
  const router = useRouter();
  const id = useId();
  const [triggerKey, setTriggerKey] = useState(initialTrigger ?? triggers[0]?.key ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState<string>('none');
  const create = useApiMutation(
    (api) =>
      api.post<WorkflowDefinition>('/workflows', {
        triggerKey,
        name,
        description: description || null,
        copyFromId: copyFrom === 'none' ? undefined : copyFrom,
      }),
    {
      invalidate: ['/workflows'],
      success: t('created'),
      onSuccess: (d) => router.push(`/admin/workflows/${d.id}`),
    },
  );
  const sources = definitions.filter((d) => d.triggerKey === triggerKey);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && triggerKey) create.mutate(undefined);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-trigger`}>{t('trigger')}</Label>
            <Select
              value={triggerKey}
              onValueChange={(v) => {
                setTriggerKey(v);
                setCopyFrom('none');
              }}
            >
              <SelectTrigger id={`${id}-trigger`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggers.map((tr) => (
                  <SelectItem key={tr.key} value={tr.key}>
                    {label(tr.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>{t('name')}</Label>
            <Input
              id={`${id}-name`}
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-desc`}>{t('descriptionLabel')}</Label>
            <Textarea
              id={`${id}-desc`}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {sources.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-copy`}>{t('copyFrom')}</Label>
              <Select value={copyFrom} onValueChange={setCopyFrom}>
                <SelectTrigger id={`${id}-copy`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('blank')}</SelectItem>
                  {sources.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {label(d.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DefinitionRow({ d }: { d: WorkflowDefinitionSummary }) {
  const t = useTranslations('workflows.list');
  const label = useLabel();
  return (
    <li>
      <Link
        href={`/admin/workflows/${d.id}`}
        className="group flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <WorkflowIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium group-hover:underline">{label(d.name)}</span>
            {d.isDefault && (
              <Badge variant="info">
                <StarIcon aria-hidden />
                {t('default')}
              </Badge>
            )}
            {d.isSystem && (
              <Badge variant="muted">
                <LockIcon aria-hidden />
                {t('system')}
              </Badge>
            )}
            {d.archived && (
              <Badge variant="muted">
                <ArchiveIcon aria-hidden />
                {t('archived')}
              </Badge>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {d.publishedVersion ? (
              <span>{t('version', { version: d.publishedVersion })}</span>
            ) : (
              <span>{t('draftOnly')}</span>
            )}
            {d.hasUnpublishedChanges && d.publishedVersion !== null && (
              <span className="text-warning-foreground">· {t('unpublished')}</span>
            )}
            <span>· {t('steps', { count: d.stepCount })}</span>
            {d.running > 0 && (
              <span className="inline-flex items-center gap-1">
                · <PlayIcon className="size-3" aria-hidden /> {t('running', { count: d.running })}
              </span>
            )}
            <span>
              · <RelativeTime date={d.updatedAt} />
              {d.updatedBy ? ` · ${d.updatedBy.displayName}` : ''}
            </span>
          </span>
        </span>
        <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function DefinitionsTab() {
  const t = useTranslations('workflows.list');
  const label = useLabel();
  const canManage = useCan('core.workflows.manage');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<string | null | false>(false);
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  const defs = useApiQuery<{ items: WorkflowDefinitionSummary[] }>('/workflows', {
    includeArchived: archived,
    q: q || undefined,
  });
  const items = defs.data?.items ?? [];
  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:w-72" />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={archived} onCheckedChange={setArchived} />
            {t('showArchived')}
          </label>
          {canManage && (
            <Button onClick={() => setCreating(null)}>
              <PlusIcon />
              {t('new')}
            </Button>
          )}
        </div>
      </div>
      {triggers.isLoading || defs.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Stagger className="grid gap-6">
          {(triggers.data?.items ?? []).map((tr) => {
            const list = items.filter((d) => d.triggerKey === tr.key);
            return (
              <StaggerItem key={tr.key}>
                <section
                  className="overflow-hidden rounded-xl border bg-card"
                  aria-labelledby={`trigger-${tr.key}`}
                >
                  <header className="flex flex-col gap-2 border-b bg-muted/30 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2
                        id={`trigger-${tr.key}`}
                        className="flex flex-wrap items-center gap-2 font-semibold"
                      >
                        {label(tr.name)}
                        <span className="font-mono text-xs font-normal text-muted-foreground">{tr.key}</span>
                        {tr.required ? (
                          <Badge variant="warning">{t('required')}</Badge>
                        ) : (
                          <Badge variant="muted">{t('optional')}</Badge>
                        )}
                      </h2>
                      {tr.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{label(tr.description)}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tr.defaultDefinition
                          ? t('usesDefault', { name: label(tr.defaultDefinition.name) })
                          : tr.key === 'core.form-submission'
                            ? t('perForm')
                            : t('noDefault')}
                      </p>
                    </div>
                    {canManage && (
                      <Button variant="outline" size="sm" onClick={() => setCreating(tr.key)}>
                        <PlusIcon />
                        {t('newFor')}
                      </Button>
                    )}
                  </header>
                  {list.length ? (
                    <ul className="divide-y">
                      {list.map((d) => (
                        <DefinitionRow key={d.id} d={d} />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-sm text-muted-foreground">{t('empty')}</p>
                  )}
                </section>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
      {creating !== false && (
        <NewWorkflowDialog
          open
          onOpenChange={(o) => !o && setCreating(false)}
          triggers={triggers.data?.items ?? []}
          definitions={items}
          initialTrigger={creating}
        />
      )}
    </div>
  );
}

function InstancesTab() {
  const t = useTranslations('workflows.instances');
  const label = useLabel();
  const locale = useLocale();
  const [state, set] = useListState({ pageSize: 25 });
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  const { data, isLoading, isFetching } = useApiQuery<Page<WorkflowInstanceSummary>>('/workflow-instances', {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    status: state.status as string | undefined,
    triggerKey: state.trigger as string | undefined,
  });
  const [open, setOpen] = useState<WorkflowInstanceSummary | null>(null);
  const triggerName = (key: string) => {
    const tr = triggers.data?.items.find((x) => x.key === key);
    return tr ? label(tr.name) : key;
  };
  const columns = useMemo<DataTableColumn<WorkflowInstanceSummary>[]>(
    () => [
      {
        id: 'subject',
        header: t('subject'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{localize(row.original.subject.label, locale)}</div>
            <div className="text-xs text-muted-foreground">{triggerName(row.original.triggerKey)}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} kind="instance" />,
      },
      {
        id: 'current',
        header: t('current'),
        cell: ({ row }) =>
          row.original.status === 'running' ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="truncate">
                {row.original.currentSteps.map((s) => localize(s.name, locale)).join(', ')}
              </span>
              <span className="flex -space-x-1.5">
                {row.original.pendingWith.slice(0, 3).map((p) => (
                  <UserAvatar
                    key={p.id}
                    name={p.displayName}
                    src={p.avatarUrl}
                    className="size-5 text-[8px] ring-2 ring-background"
                  />
                ))}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'requester',
        header: t('requester'),
        cell: ({ row }) => row.original.requester?.displayName ?? '—',
      },
      {
        id: 'started',
        header: t('started'),
        cell: ({ row }) => <RelativeTime date={row.original.startedAt} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, triggers.data],
  );
  return (
    <>
      <DataTable
        label={t('label')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(r) => r.id}
        onRowClick={setOpen}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q: q || undefined })}
              placeholder={t('search')}
              className="w-64"
            />
            <Select
              value={(state.status as string) ?? 'all'}
              onValueChange={(v) => set({ status: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="w-40" aria-label={t('status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {(['running', 'approved', 'rejected', 'cancelled'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    <StatusBadge status={s} kind="instance" />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={(state.trigger as string) ?? 'all'}
              onValueChange={(v) => set({ trigger: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="w-48" aria-label={t('trigger')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allTriggers')}</SelectItem>
                {(triggers.data?.items ?? []).map((tr) => (
                  <SelectItem key={tr.key} value={tr.key}>
                    {label(tr.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <InstanceSheet
        instanceId={open?.id ?? null}
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpen(null)}
        triggerName={open ? triggerName(open.triggerKey) : undefined}
      />
    </>
  );
}

/** Workflow definitions per trigger, and every running/finished instance. */
export function WorkflowsView() {
  const t = useTranslations('workflows.list');
  const [state, set] = useListState();
  const tab = state.tab === 'instances' ? 'instances' : 'definitions';
  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs
        value={tab}
        onValueChange={(v) => set({ tab: v === 'definitions' ? undefined : v })}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="definitions">{t('tabs.definitions')}</TabsTrigger>
          <TabsTrigger value="instances">{t('tabs.instances')}</TabsTrigger>
        </TabsList>
        <TabsContent value="definitions">
          <DefinitionsTab />
        </TabsContent>
        <TabsContent value="instances">
          <InstancesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
