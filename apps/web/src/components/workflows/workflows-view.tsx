'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { List } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type {
  FormSummary,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowInstanceSummary,
  WorkflowTrigger,
} from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { IconTile } from '@isbp/ui/icon-tile';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArchiveIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleOffIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { InstanceSheet } from '../approvals/instance-sheet';
import { StatusBadge } from './status-badges';
import { FORM_TRIGGER, useAreaName } from './workflow-labels';

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
  const area = useAreaName();
  const router = useRouter();
  const formId = useId();
  const [triggerKey, setTriggerKey] = useState(
    initialTrigger ?? triggers.find((x) => x.key !== FORM_TRIGGER)?.key ?? triggers[0]?.key ?? '',
  );
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={<DialogHeader title={t('title')} subtitle={t('description')} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && triggerKey) create.mutate(undefined);
              }}
            >
              <FormLayout defaultOptionality="optional">
                <Selector
                  label={t('trigger')}
                  width="100%"
                  value={triggerKey}
                  description={triggerKey === FORM_TRIGGER ? t('formHint') : undefined}
                  options={triggers.map((tr) => ({
                    value: tr.key,
                    label:
                      tr.key === FORM_TRIGGER ? label(tr.name) : `${area(tr.moduleId)} · ${label(tr.name)}`,
                  }))}
                  onChange={(v) => {
                    setTriggerKey(v);
                    setCopyFrom('none');
                  }}
                />
                <TextInput label={t('name')} isRequired value={name} onChange={setName} />
                <TextArea
                  label={t('descriptionLabel')}
                  rows={2}
                  isOptional
                  value={description}
                  onChange={setDescription}
                />
                {sources.length > 0 && (
                  <Selector
                    label={t('copyFrom')}
                    width="100%"
                    value={copyFrom}
                    options={[
                      { value: 'none', label: t('blank') },
                      ...sources.map((d) => ({ value: d.id, label: label(d.name) })),
                    ]}
                    onChange={setCopyFrom}
                  />
                )}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={t('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('submit')}
                variant="primary"
                type="submit"
                form={formId}
                isDisabled={!name.trim()}
                isLoading={create.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function DefinitionRow({
  d,
  usedBy,
  isForm,
}: {
  d: WorkflowDefinitionSummary;
  /** Names of the forms that use it (approvals for forms). */
  usedBy?: string[];
  isForm: boolean;
}) {
  const t = useTranslations('workflows.list');
  const label = useLabel();
  return (
    <Item
      as="li"
      href={`/admin/workflows/${d.id}`}
      startContent={
        <IconTile aria-hidden>
          <WorkflowIcon />
        </IconTile>
      }
      label={
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text weight="medium">{label(d.name)}</Text>
          {d.isDefault && !isForm && (
            <Badge variant="info" label={t('inUse')} icon={<Icon icon={CircleCheckIcon} size="xsm" />} />
          )}
          {d.isSystem && (
            <Badge variant="neutral" label={t('system')} icon={<Icon icon={LockIcon} size="xsm" />} />
          )}
          {d.archived && (
            <Badge variant="neutral" label={t('archived')} icon={<Icon icon={ArchiveIcon} size="xsm" />} />
          )}
        </HStack>
      }
      description={
        <VStack gap={0.5}>
          <Text type="supporting" color="secondary" as="div">
            {d.publishedVersion ? t('version', { version: d.publishedVersion }) : t('draftOnly')}
            {d.hasUnpublishedChanges && d.publishedVersion !== null && <> · {t('unpublished')}</>}
            {' · '}
            {t('steps', { count: d.stepCount })}
            {d.running > 0 && (
              <>
                {' · '}
                <span className="inline-flex items-center gap-1 align-middle">
                  <Icon icon={PlayIcon} size="xsm" /> {t('running', { count: d.running })}
                </span>
              </>
            )}
            {' · '}
            <RelativeTime date={d.updatedAt} />
            {d.updatedBy ? ` · ${d.updatedBy.displayName}` : ''}
          </Text>
          {isForm && (
            <Text type="supporting" color="secondary" maxLines={1}>
              {usedBy?.length ? t('usedByForms', { names: usedBy.join(', ') }) : t('usedByNoForm')}
            </Text>
          )}
        </VStack>
      }
      endContent={<Icon icon={ChevronRightIcon} color="secondary" />}
    />
  );
}

/** One built-in approval (a trigger): what it's for, whether it must run, and its workflows. */
function TriggerSection({
  trigger,
  list,
  canManage,
  onCreate,
}: {
  trigger: WorkflowTrigger;
  list: WorkflowDefinitionSummary[];
  canManage: boolean;
  onCreate: () => void;
}) {
  const t = useTranslations('workflows.list');
  const label = useLabel();
  const headingId = useId();
  const inUse = list.some((d) => d.isDefault && !d.archived && d.publishedVersion !== null);
  return (
    <section aria-labelledby={headingId} className="border-t first:border-t-0">
      <VStack gap={0.5} className="px-4 py-2.5">
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading level={3} id={headingId}>
            {label(trigger.name)}
          </Heading>
          {trigger.required ? (
            <Badge
              variant="warning"
              label={t('required')}
              icon={<Icon icon={ShieldCheckIcon} size="xsm" />}
            />
          ) : inUse ? (
            <Badge variant="success" label={t('on')} icon={<Icon icon={CircleCheckIcon} size="xsm" />} />
          ) : (
            <Badge variant="neutral" label={t('off')} icon={<Icon icon={CircleOffIcon} size="xsm" />} />
          )}
        </HStack>
        {trigger.description && (
          <Text type="supporting" color="secondary">
            {label(trigger.description)}
          </Text>
        )}
      </VStack>
      {list.length ? (
        <List hasDividers density="compact">
          {list.map((d) => (
            <DefinitionRow key={d.id} d={d} isForm={false} />
          ))}
        </List>
      ) : (
        <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap" className="px-4 py-4">
          <Text color="secondary">{t('empty')}</Text>
          {canManage && (
            <Button
              label={t('setUp')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              onClick={onCreate}
            />
          )}
        </HStack>
      )}
    </section>
  );
}

function DefinitionsTab({ onCreate }: { onCreate: (trigger: string | null) => void }) {
  const t = useTranslations('workflows.list');
  const locale = useLocale();
  const area = useAreaName();
  const canManage = useCan('core.workflows.manage');
  const canForms = useCan('core.forms.manage');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  const defs = useApiQuery<{ items: WorkflowDefinitionSummary[] }>('/workflows', {
    includeArchived: archived,
    q: q || undefined,
  });
  const forms = useApiQuery<{ items: FormSummary[] }>(canForms ? '/forms' : null);
  const items = defs.data?.items ?? [];
  const usedBy = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of forms.data?.items ?? [])
      if (f.workflow)
        map.set(f.workflow.id, [...(map.get(f.workflow.id) ?? []), localize(f.name, locale) || f.key]);
    return map;
  }, [forms.data, locale]);
  const formTrigger = triggers.data?.items.find((tr) => tr.key === FORM_TRIGGER);
  const formList = items.filter((d) => d.triggerKey === FORM_TRIGGER);
  // Built-in approvals by area, required ones first within an area.
  const areas = useMemo(() => {
    const map = new Map<string, WorkflowTrigger[]>();
    for (const tr of triggers.data?.items ?? []) {
      if (tr.key === FORM_TRIGGER) continue;
      const name = area(tr.moduleId);
      map.set(name, [...(map.get(name) ?? []), tr]);
    }
    return [...map]
      .map(([name, list]) => ({
        name,
        list: list.sort((a, b) => Number(b.required) - Number(a.required)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [triggers.data, area, locale]);
  const formsHeading = useId();
  const builtInHeading = useId();

  return (
    <VStack gap={4}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:w-72" />
        <Switch label={t('showArchived')} value={archived} onChange={setArchived} />
      </div>
      {triggers.isLoading || defs.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Stagger className="grid gap-5">
          {formTrigger && (
            <StaggerItem>
              <section aria-labelledby={formsHeading} className="grid gap-2">
                <VStack gap={0.5}>
                  <Heading level={2} id={formsHeading}>
                    {t('formsTitle')}
                  </Heading>
                  <Text color="secondary">{t('formsDescription')}</Text>
                </VStack>
                <Card padding={0}>
                  {formList.length ? (
                    <List hasDividers density="compact">
                      {formList.map((d) => (
                        <DefinitionRow key={d.id} d={d} isForm usedBy={usedBy.get(d.id)} />
                      ))}
                    </List>
                  ) : (
                    <Text color="secondary" as="p" className="px-4 py-6">
                      {t('formsEmpty')}
                    </Text>
                  )}
                </Card>
              </section>
            </StaggerItem>
          )}
          <StaggerItem>
            <section aria-labelledby={builtInHeading} className="grid gap-2">
              <VStack gap={0.5}>
                <Heading level={2} id={builtInHeading}>
                  {t('builtInTitle')}
                </Heading>
                <Text color="secondary">{t('builtInDescription')}</Text>
              </VStack>
              <VStack gap={4}>
                {areas.map((a) => (
                  <Card key={a.name} padding={0}>
                    <Text
                      type="supporting"
                      color="secondary"
                      weight="semibold"
                      as="p"
                      className="border-b px-4 py-2"
                    >
                      {a.name}
                    </Text>
                    {a.list.map((tr) => (
                      <TriggerSection
                        key={tr.key}
                        trigger={tr}
                        list={items.filter((d) => d.triggerKey === tr.key)}
                        canManage={canManage}
                        onCreate={() => onCreate(tr.key)}
                      />
                    ))}
                  </Card>
                ))}
              </VStack>
            </section>
          </StaggerItem>
        </Stagger>
      )}
    </VStack>
  );
}

const ALL = '__all__';

function InstancesTab() {
  const t = useTranslations('workflows.instances');
  const ts = useTranslations('workflows.status');
  const label = useLabel();
  const locale = useLocale();
  const [state, set] = useListState({ pageSize: 25 });
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<WorkflowInstanceSummary>>(
    '/workflow-instances',
    {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
      status: state.status as string | undefined,
      triggerKey: state.trigger as string | undefined,
    },
  );
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
        error={error}
        onRetry={() => refetch()}
        getRowId={(r) => r.id}
        onRowClick={setOpen}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <HStack gap={2} vAlign="center" wrap="wrap">
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q: q || undefined })}
              placeholder={t('search')}
              className="w-64"
            />
            <Selector
              label={t('status')}
              isLabelHidden
              width={176}
              value={(state.status as string) ?? ALL}
              options={[
                { value: ALL, label: t('allStatuses') },
                ...(['running', 'approved', 'rejected', 'cancelled'] as const).map((s) => ({
                  value: s,
                  label: ts(`instance.${s}`),
                })),
              ]}
              onChange={(v) => set({ status: v === ALL ? undefined : v })}
            />
            <Selector
              label={t('trigger')}
              isLabelHidden
              width={208}
              hasSearch={(triggers.data?.items.length ?? 0) > 12}
              value={(state.trigger as string) ?? ALL}
              options={[
                { value: ALL, label: t('allTriggers') },
                ...(triggers.data?.items ?? []).map((tr) => ({ value: tr.key, label: label(tr.name) })),
              ]}
              onChange={(v) => set({ trigger: v === ALL ? undefined : v })}
            />
          </HStack>
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

/** Approvals for forms, built-in approvals by area, and every running/finished instance. */
export function WorkflowsView() {
  const t = useTranslations('workflows.list');
  const [state, set] = useListState();
  const canManage = useCan('core.workflows.manage');
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  const defs = useApiQuery<{ items: WorkflowDefinitionSummary[] }>('/workflows', { includeArchived: true });
  const [creating, setCreating] = useState<string | null | false>(false);
  const panelId = useId();
  const tab = state.tab === 'instances' ? 'instances' : 'definitions';
  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <Button
              label={t('new')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreating(null)}
            />
          ) : undefined
        }
      />
      <VStack gap={4}>
        <TabList
          role="tablist"
          aria-label={t('title')}
          value={tab}
          onChange={(v) => set({ tab: v === 'definitions' ? undefined : v })}
          hasDivider
        >
          <Tab value="definitions" panelId={panelId} label={t('tabs.definitions')} />
          <Tab value="instances" panelId={panelId} label={t('tabs.instances')} />
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)}>
          {tab === 'definitions' ? <DefinitionsTab onCreate={setCreating} /> : <InstancesTab />}
        </div>
      </VStack>
      {creating !== false && (
        <NewWorkflowDialog
          open
          onOpenChange={(o) => !o && setCreating(false)}
          triggers={triggers.data?.items ?? []}
          definitions={defs.data?.items ?? []}
          initialTrigger={creating}
        />
      )}
    </div>
  );
}
