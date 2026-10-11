'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  FileTextIcon,
  GavelIcon,
  PencilIcon,
  StoreIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { CatalogItem, upsertCatalogItemSchema } from '../../contracts';
import { PriorityBadge } from '../components/badges';
import { CategorySelect } from '../components/pickers';
import { INVALIDATE, useCategoryLabel } from '../lib';
import { DefaultGroupSelect, DeleteButton, SettingsSection } from './shared';

type CatalogInput = z.input<typeof upsertCatalogItemSchema>;
type FulfilOn = 'submitted' | 'approved';

function FormIcon({ name }: { name: string }) {
  return (
    <DynamicIcon
      name={(name || 'file-text') as IconName}
      aria-hidden
      fallback={() => <FileTextIcon aria-hidden />}
    />
  );
}

function CatalogSheet({
  item,
  open,
  onOpenChange,
}: {
  item: CatalogItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.settingsPage.catalog');
  const tt = useTranslations('itsm');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [active, setActive] = useState(true);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [priority, setPriority] = useState(3);
  const [fulfilOn, setFulfilOn] = useState<FulfilOn>('approved');
  useEffect(() => {
    if (!open || !item) return;
    const f = item.fulfilment;
    setActive(f?.active ?? true);
    setCategoryId(f?.category?.id ?? null);
    setGroupId(f?.group?.id ?? null);
    setPriority(f?.priority ?? 3);
    setFulfilOn(f?.fulfilOn ?? (item.hasApproval ? 'approved' : 'submitted'));
  }, [open, item]);
  const save = useApiMutation(
    (api, body: CatalogInput) =>
      api.put<CatalogItem>(`/itsm/catalog/${encodeURIComponent(item!.formKey)}`, body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  const remove = useApiMutation((api) => api.delete(`/itsm/catalog/${encodeURIComponent(item!.formKey)}`), {
    invalidate: INVALIDATE,
    success: t('stopped'),
    onSuccess: () => onOpenChange(false),
  });
  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <SheetForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ active, categoryId, groupId, priority, fulfilOn });
          }}
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <IconTile size="xs" aria-hidden>
                <FormIcon name={item.formIcon} />
              </IconTile>
              {localize(item.formName, locale)}
            </SheetTitle>
            <SheetDescription>{t('sheetHint')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="pb-6">
            <FormLayout defaultOptionality="optional">
              <Switch label={t('active')} description={t('activeHint')} value={active} onChange={setActive} />
              <CategorySelect
                label={t('category')}
                type="service_request"
                value={categoryId}
                onChange={setCategoryId}
              />
              <DefaultGroupSelect label={t('group')} value={groupId} onChange={setGroupId} />
              <Selector
                label={t('priority')}
                value={String(priority)}
                onChange={(v) => setPriority(Number(v))}
                options={[1, 2, 3, 4].map((p) => ({ value: String(p), label: tt(`priority.${p}`) }))}
              />
              <RadioList label={t('fulfilOn')} value={fulfilOn} onChange={(v) => setFulfilOn(v as FulfilOn)}>
                <RadioListItem
                  value="submitted"
                  label={t('on.submitted')}
                  description={t('on.submittedHint')}
                />
                <RadioListItem
                  value="approved"
                  label={t('on.approved')}
                  description={item.hasApproval ? t('on.approvedHint') : t('on.noApproval')}
                  isDisabled={!item.hasApproval}
                />
              </RadioList>
            </FormLayout>
          </SheetBody>
          <SheetFooter>
            {item.fulfilment && (
              <DeleteButton
                title={t('stopTitle')}
                description={t('stopBody')}
                onConfirm={() => remove.mutate(undefined)}
                pending={remove.isPending}
              />
            )}
            <Button label={tc('cancel')} variant="secondary" onClick={() => onOpenChange(false)} />
            <Button label={tc('save')} variant="primary" isLoading={save.isPending} type="submit" />
          </SheetFooter>
        </SheetForm>
      </SheetContent>
    </Sheet>
  );
}

/** Published Phase 1 forms and how the service desk fulfils each (category, group, priority, moment). */
export function CatalogTab() {
  const t = useTranslations('itsm.settingsPage.catalog');
  const ts = useTranslations('itsm.settingsPage');
  const tc = useTranslations('common');
  const locale = useLocale();
  const categoryLabel = useCategoryLabel();
  const { data, isLoading, error, refetch } = useApiQuery<{ items: CatalogItem[] }>('/itsm/catalog');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <SettingsSection
      id="itsm-catalog-title"
      title={t('title')}
      description={t('description')}
      action={
        <Button
          label={t('formBuilder')}
          variant="secondary"
          endContent={<Icon icon={ArrowUpRightIcon} />}
          href="/admin/forms"
        />
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} kind="list" className="rounded-xl border" />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<StoreIcon />}
          title={t('empty')}
          description={t('emptyHint')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <List hasDividers>
          {data.items.map((item) => {
            const f = item.fulfilment;
            const name = localize(item.formName, locale);
            return (
              <ListItem
                key={item.formKey}
                label={name}
                startContent={
                  <IconTile aria-hidden>
                    <FormIcon name={item.formIcon} />
                  </IconTile>
                }
                description={
                  <HStack gap={2} wrap="wrap" vAlign="center">
                    {item.hasApproval && (
                      <Badge
                        variant="info"
                        label={t('approval')}
                        icon={<Icon icon={GavelIcon} size="xsm" />}
                      />
                    )}
                    {f ? (
                      <>
                        <StatusBadge
                          tone={f.active ? 'success' : 'muted'}
                          icon={f.active ? CircleCheckIcon : CirclePauseIcon}
                          label={f.active ? t('fulfilled') : t('paused')}
                        />
                        <Text color="secondary">
                          {[categoryLabel(f.category), f.group?.name].filter(Boolean).join(' · ') ||
                            t('noRouting')}
                        </Text>
                        <PriorityBadge priority={f.priority} />
                        <Text type="supporting">
                          {t(`on.${f.fulfilOn}`)} · {t('ticketCount', { count: f.ticketCount })}
                        </Text>
                      </>
                    ) : (
                      <Text color="secondary">{t('notFulfilled')}</Text>
                    )}
                  </HStack>
                }
                endContent={
                  <Button
                    label={f ? tc('edit') : t('setUp')}
                    aria-label={f ? ts('editItem', { name }) : t('setUpItem', { name })}
                    variant={f ? 'ghost' : 'secondary'}
                    size="sm"
                    icon={<Icon icon={PencilIcon} />}
                    onClick={() => {
                      setEditing(item);
                      setOpen(true);
                    }}
                  />
                }
              />
            );
          })}
        </List>
      )}
      <CatalogSheet item={editing} open={open} onOpenChange={setOpen} />
    </SettingsSection>
  );
}
