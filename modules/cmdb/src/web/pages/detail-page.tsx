'use client';

import { localize } from '@isbp/sdk';
import { Slot, useSlot, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedNumber, FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  CableIcon,
  FileQuestionIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TagIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { CiDetail, CiRelatedSlotProps } from '../../contracts';
import { CiStatusBadge, CriticalityBadge, EnvironmentBadge } from '../badges';
import { CiFormDialog } from '../ci-form-dialog';
import { ClassIcon } from '../class-icon';
import { ConfirmDialog } from '../confirm-dialog';
import { CustomFieldsCard } from '../custom-fields';
import { INVALIDATE } from '../data';
import { ImpactPanel, useImpact } from '../impact-panel';
import { RelationshipDialog } from '../relationship-dialog';
import { RelationshipsPanel } from '../relationships-panel';

const RELATED_SLOT = 'cmdb.ci.related';
type Tab = 'overview' | 'relationships' | 'impact';
type Dialog = 'edit' | 'relate' | 'retire' | 'delete' | null;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/** "If this fails": upstream impact at the default depth, linking to the Impact tab. */
function ImpactSummary({ ci, onOpen }: { ci: CiDetail; onOpen: () => void }) {
  const t = useTranslations('cmdb');
  const { data } = useImpact(ci.id, 3);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.ifItFails')}</CardTitle>
        <CardDescription>{t('detail.withinLevels', { depth: 3 })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight">
                <AnimatedNumber value={data.impacted.length} />
              </span>
              <span className="text-sm text-muted-foreground">
                {t('detail.impactedCount', { count: data.impacted.length })}
              </span>
            </div>
            <p
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium',
                data.impactedServices ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <BriefcaseBusinessIcon className="size-4" aria-hidden />
              {t('detail.impactedServices', { count: data.impactedServices })}
            </p>
            {data.impactedServices > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label={t('impact.service')}>
                {data.impacted
                  .filter((n) => n.isService)
                  .slice(0, 8)
                  .map((n) => (
                    <li key={n.ci.id}>
                      <Badge variant="outline" asChild>
                        <Link href={`/cmdb/${n.ci.reference}`} className="hover:bg-accent">
                          {n.ci.name}
                        </Link>
                      </Badge>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
        <Button variant="outline" size="sm" onClick={onOpen}>
          {t('detail.viewImpact')} <ArrowRightIcon />
        </Button>
      </CardContent>
    </Card>
  );
}

/** "Related work": other modules (e.g. ITSM's open tickets) contribute through the `cmdb.ci.related` slot. */
function RelatedWork({ ci }: { ci: CiDetail }) {
  const t = useTranslations('cmdb');
  const contributions = useSlot(RELATED_SLOT);
  if (!contributions.length) return null;
  const props: CiRelatedSlotProps = {
    ci: { id: ci.id, number: ci.number, reference: ci.reference, name: ci.name },
  };
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('detail.relatedWork')}</CardTitle>
        <CardDescription>{t('detail.relatedWorkHint')}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <Slot name={RELATED_SLOT} props={props} fallback={<Skeleton className="h-16 w-full" />} />
      </CardContent>
    </Card>
  );
}

export default function CiDetailPage({ params }: WebPageProps) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const path = `/cmdb/cis/${encodeURIComponent(params.ref ?? '')}`;
  const { data: ci, isLoading, error } = useApiQuery<CiDetail>(path);
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (open: boolean) => !open && setDialog(null);

  const retire = useApiMutation((api) => api.post<CiDetail>(`/cmdb/cis/${ci!.id}/retire`), {
    invalidate: INVALIDATE,
    success: (r) => t('detail.retired', { reference: r.reference }),
    onSuccess: () => setDialog(null),
  });
  const remove = useApiMutation((api) => api.delete(`/cmdb/cis/${ci!.id}`), {
    invalidate: INVALIDATE,
    success: () => t('detail.deleted', { reference: ci!.reference }),
    onSuccess: () => router.push('/cmdb'),
  });

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !ci) return <EmptyState icon={<FileQuestionIcon />} title={t('detail.notFound')} />;

  const className = localize(ci.class.name, locale);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/cmdb">
          <ArrowLeftIcon /> {t('list.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ClassIcon name={ci.class.icon} className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{ci.reference}</span>
              <span aria-hidden>·</span>
              <span>{className}</span>
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{ci.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <CiStatusBadge status={ci.status} />
              <CriticalityBadge criticality={ci.criticality} />
              {ci.environment && <EnvironmentBadge environment={ci.environment} />}
            </div>
          </div>
        </div>
        {ci.canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('detail.edit')}
            </Button>
            <Button variant="outline" onClick={() => setDialog('relate')}>
              <CableIcon /> {t('detail.addRelationship')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('detail.more')}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem disabled={ci.status === 'retired'} onSelect={() => setDialog('retire')}>
                  <ArchiveIcon /> {t('detail.retire')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
                  <Trash2Icon /> {t('detail.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </FadeIn>

      {ci.status === 'retired' && (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <ArchiveIcon className="size-4 shrink-0" aria-hidden />
          {t('detail.retiredBanner')}
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="relationships">
            {t('detail.tabs.relationships')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {ci.relationshipCounts.total}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="impact">{t('detail.tabs.impact')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid min-w-0 items-start gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.details')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div:nth-last-child(-n+1)]:border-0 sm:[&>div:nth-last-child(-n+2)]:border-0">
                  <Field label={t('fields.class')}>
                    <span className="inline-flex items-center gap-1.5">
                      <ClassIcon name={ci.class.icon} className="size-4 text-muted-foreground" />
                      {className}
                    </span>
                  </Field>
                  <Field label={t('fields.status')}>
                    <CiStatusBadge status={ci.status} />
                  </Field>
                  <Field label={t('fields.environment')}>
                    {ci.environment ? t(`environment.${ci.environment}`) : null}
                  </Field>
                  <Field label={t('fields.criticality')}>
                    <CriticalityBadge criticality={ci.criticality} />
                  </Field>
                  <Field label={t('fields.owner')}>
                    {ci.owner && (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <UserAvatar
                          name={ci.owner.displayName}
                          src={ci.owner.avatarUrl}
                          className="size-5 text-[9px]"
                        />
                        <span className="truncate">{ci.owner.displayName}</span>
                      </span>
                    )}
                  </Field>
                  <Field label={t('fields.supportGroup')}>{ci.supportGroup?.name}</Field>
                  <Field label={t('fields.department')}>{ci.department?.name}</Field>
                  <Field label={t('fields.number')}>
                    <span className="font-mono text-xs">{ci.reference}</span>
                  </Field>
                  <Field label={t('fields.created')}>
                    <DateTime date={ci.createdAt} />
                  </Field>
                  <Field label={t('fields.updated')}>
                    <RelativeTime date={ci.updatedAt} />
                  </Field>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.description')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {ci.description ? (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{ci.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('detail.noDescription')}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <TagIcon className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="sr-only">{t('fields.tags')}</span>
                  {ci.tags.length ? (
                    ci.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-normal">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">{t('detail.noTags')}</span>
                  )}
                </div>
              </CardContent>
            </Card>
            <CustomFieldsCard attributes={ci.attributes} />
          </div>
          <div className="min-w-0 space-y-6">
            <ImpactSummary ci={ci} onOpen={() => setTab('impact')} />
            <RelatedWork ci={ci} />
          </div>
        </TabsContent>

        <TabsContent value="relationships" className="min-w-0">
          <RelationshipsPanel ciRef={ci.id} canManage={ci.canManage} onAdd={() => setDialog('relate')} />
        </TabsContent>

        <TabsContent value="impact" className="min-w-0">
          <ImpactPanel ci={ci} />
        </TabsContent>
      </Tabs>

      {ci.canManage && (
        <>
          <CiFormDialog open={dialog === 'edit'} onOpenChange={close} ci={ci} />
          <RelationshipDialog ci={ci} open={dialog === 'relate'} onOpenChange={close} />
          <ConfirmDialog
            open={dialog === 'retire'}
            onOpenChange={close}
            title={t('detail.retireTitle', { name: ci.name })}
            description={t('detail.retireBody')}
            confirmLabel={t('detail.retire')}
            loading={retire.isPending}
            onConfirm={() => retire.mutate(undefined)}
          />
          <ConfirmDialog
            open={dialog === 'delete'}
            onOpenChange={close}
            title={t('detail.deleteTitle', { name: ci.name })}
            description={t('detail.deleteBody', { count: ci.relationshipCounts.total })}
            confirmLabel={tc('delete')}
            destructive
            loading={remove.isPending}
            onConfirm={() => remove.mutate(undefined)}
          />
        </>
      )}
    </div>
  );
}
