'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
import { Switch } from '@isbp/ui/switch';
import { ArrowUpRightIcon, FileTextIcon, GavelIcon, PencilIcon, StoreIcon } from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { z } from 'zod';
import type { CatalogItem, upsertCatalogItemSchema } from '../../contracts';
import { PriorityBadge } from '../components/badges';
import { CategorySelect } from '../components/pickers';
import { INVALIDATE, useCategoryLabel } from '../lib';
import { DefaultGroupSelect, DeleteButton } from './shared';

type CatalogInput = z.input<typeof upsertCatalogItemSchema>;
type FulfilOn = 'submitted' | 'approved';

function FormIcon({ name, className }: { name: string; className?: string }) {
  return (
    <DynamicIcon
      name={(name || 'file-text') as IconName}
      className={className}
      aria-hidden
      fallback={() => <FileTextIcon className={className} aria-hidden />}
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
  const id = useId();
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
              <FormIcon name={item.formIcon} className="size-5 text-primary" />
              {localize(item.formName, locale)}
            </SheetTitle>
            <SheetDescription>{t('sheetHint')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5 pb-6">
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <Label htmlFor={`${id}-active`} className="flex-col items-start gap-0.5">
                <span>{t('active')}</span>
                <span className="text-xs font-normal text-muted-foreground">{t('activeHint')}</span>
              </Label>
              <Switch id={`${id}-active`} checked={active} onCheckedChange={setActive} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-category`}>{t('category')}</Label>
              <CategorySelect
                id={`${id}-category`}
                type="service_request"
                value={categoryId}
                onChange={setCategoryId}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-group`}>{t('group')}</Label>
              <DefaultGroupSelect id={`${id}-group`} value={groupId} onChange={setGroupId} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-priority`}>{t('priority')}</Label>
              <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
                <SelectTrigger id={`${id}-priority`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {tt(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('fulfilOn')}</legend>
              {(['submitted', 'approved'] as const).map((o) => (
                <label
                  key={o}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                    fulfilOn === o ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    o === 'approved' && !item.hasApproval && 'opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-on`}
                    value={o}
                    checked={fulfilOn === o}
                    onChange={() => setFulfilOn(o)}
                    disabled={o === 'approved' && !item.hasApproval}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{t(`on.${o}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {o === 'approved' && !item.hasApproval ? t('on.noApproval') : t(`on.${o}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tc('save')}
            </Button>
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
    <section className="grid gap-4" aria-labelledby="itsm-catalog-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="itsm-catalog-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/forms">
            {t('formBuilder')}
            <ArrowUpRightIcon />
          </Link>
        </Button>
      </div>
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
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {data.items.map((item) => {
            const f = item.fulfilment;
            const name = localize(item.formName, locale);
            return (
              <li
                key={item.formKey}
                className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FormIcon name={item.formIcon} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{name}</p>
                    {item.hasApproval && (
                      <Badge variant="info" className="mt-0.5 gap-1">
                        <GavelIcon aria-hidden />
                        {t('approval')}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="min-w-0 text-sm">
                  {f ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Badge variant={f.active ? 'success' : 'muted'}>
                        {f.active ? t('fulfilled') : t('paused')}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {[categoryLabel(f.category), f.group?.name].filter(Boolean).join(' · ') ||
                          t('noRouting')}
                      </span>
                      <PriorityBadge priority={f.priority} />
                      <span className="text-xs text-muted-foreground">
                        {t(`on.${f.fulfilOn}`)} · {t('ticketCount', { count: f.ticketCount })}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{t('notFulfilled')}</span>
                  )}
                </div>
                <Button
                  variant={f ? 'ghost' : 'outline'}
                  size="sm"
                  className="justify-self-start sm:justify-self-end"
                  onClick={() => {
                    setEditing(item);
                    setOpen(true);
                  }}
                  aria-label={f ? ts('editItem', { name }) : t('setUpItem', { name })}
                >
                  <PencilIcon />
                  {f ? tc('edit') : t('setUp')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <CatalogSheet item={editing} open={open} onOpenChange={setOpen} />
    </section>
  );
}
