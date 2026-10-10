'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';

import { localize } from '@isbp/sdk';
import { ApiError, Slot, useSlot, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { BackLink, DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ArchiveIcon, ArrowRightIcon, CableIcon, PencilIcon, TagIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { CiDetail, CiRelatedSlotProps } from '../../contracts';
import { CiStatusBadge, CriticalityBadge, EnvironmentBadge } from '../badges';
import { CiFormDialog } from '../ci-form-dialog';
import { ClassIcon } from '../class-icon';
import { ConfirmDialog } from '../confirm-dialog';
import { CustomFieldsCard } from '../custom-fields';
import { ciHref, INVALIDATE } from '../data';
import { ImpactPanel, ImpactSentence, useImpact } from '../impact-panel';
import { RelationshipDialog } from '../relationship-dialog';
import { RelationshipsPanel } from '../relationships-panel';

const RELATED_SLOT = 'cmdb.ci.related';
const TABS = ['overview', 'relationships', 'impact'] as const;
type Tab = (typeof TABS)[number];
type Dialog = 'edit' | 'relate' | 'retire' | 'delete' | null;
/** Depth of the "If this fails" summary on the overview. */
const SUMMARY_DEPTH = 3;
/** Business services named on the summary card before "+N more". */
const SUMMARY_SERVICES = 8;

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

/** "If this fails": the business services an outage reaches, in one sentence, linking to the Impact tab. */
function ImpactSummary({ ci, onOpen }: { ci: CiDetail; onOpen: () => void }) {
  const t = useTranslations('cmdb');
  const { data, error, refetch } = useImpact(ci.id, SUMMARY_DEPTH);
  const services = data?.impacted.filter((n) => n.isService) ?? [];
  const more = services.length - SUMMARY_SERVICES;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.ifItFails')}</CardTitle>
        <CardDescription>{t('detail.withinLevels', { depth: SUMMARY_DEPTH })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && !data ? (
          <ErrorState compact error={error} onRetry={() => refetch()} />
        ) : !data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <ImpactSentence impact={data} />
            {services.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label={t('impact.service')}>
                {services.slice(0, SUMMARY_SERVICES).map((n) => (
                  <li key={n.ci.id}>
                    <Badge variant="outline" asChild>
                      <Link href={ciHref(n.ci)} className="hover:bg-accent">
                        {n.ci.name}
                      </Link>
                    </Badge>
                  </li>
                ))}
                {more > 0 && (
                  <li className="self-center text-xs text-muted-foreground">
                    {t('detail.moreServices', { count: more })}
                  </li>
                )}
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

/** Description and tags; hidden while both are empty (Edit adds them). */
function DescriptionCard({ ci }: { ci: CiDetail }) {
  const t = useTranslations('cmdb');
  if (!ci.description && !ci.tags.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.description')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {ci.description && <p className="text-sm leading-relaxed whitespace-pre-wrap">{ci.description}</p>}
        {ci.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <TagIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('fields.tags')}</span>
            {ci.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The open tab lives in the URL (`?tab=impact`), so "View impact" and other pages can link straight to it. */
function useTab(): [Tab, (tab: Tab) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const raw = search.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'overview';
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(search.toString());
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [tab, setTab];
}

export default function CiDetailPage({ params }: WebPageProps) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const path = `/cmdb/cis/${encodeURIComponent(params.ref ?? '')}`;
  const { data: ci, isLoading, error, refetch } = useApiQuery<CiDetail>(path);
  const [tab, setTab] = useTab();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (open: boolean) => !open && setDialog(null);
  const back = { href: '/cmdb', label: t('list.title'), highlight: ci?.id };

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
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  // An error only replaces the page when there is nothing to show (a refetch that fails right after a delete keeps
  // the record on screen until the page moves on).
  if (!ci) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-5">
        <BackLink href={back.href} label={back.label} />
        <ErrorState
          kind="page"
          error={error}
          title={missing ? t('detail.notFound') : undefined}
          onRetry={() => refetch()}
          className="rounded-xl border"
        />
      </div>
    );
  }

  const className = localize(ci.class.name, locale);

  return (
    <div>
      <DetailHeader
        back={back}
        icon={<ClassIcon name={ci.class.icon} />}
        reference={`${ci.reference} · ${className}`}
        title={ci.name}
        status={<CiStatusBadge status={ci.status} quiet={false} animate />}
        badges={
          <>
            <CriticalityBadge criticality={ci.criticality} chip />
            {ci.environment && <EnvironmentBadge environment={ci.environment} chip />}
          </>
        }
        actions={
          ci.canManage
            ? [
                {
                  id: 'edit',
                  label: t('detail.edit'),
                  icon: <PencilIcon />,
                  onSelect: () => setDialog('edit'),
                },
                {
                  id: 'relate',
                  label: t('detail.addRelationship'),
                  icon: <CableIcon />,
                  onSelect: () => setDialog('relate'),
                },
              ]
            : []
        }
        menu={
          ci.canManage
            ? [
                {
                  id: 'retire',
                  label: t('detail.retire'),
                  icon: <ArchiveIcon />,
                  disabled: ci.status === 'retired',
                  onSelect: () => setDialog('retire'),
                },
                {
                  id: 'delete',
                  label: t('detail.delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setDialog('delete'),
                },
              ]
            : []
        }
      />

      <div className="space-y-5">
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

          {/*
            "If this fails" answers the question people open a CI for, so it comes first in the reading order (right
            after the header on a phone) and sits at the top of the side column on wide screens.
          */}
          <TabsContent
            value="overview"
            className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]"
          >
            <div className="min-w-0 lg:col-start-3 lg:row-start-1">
              <ImpactSummary ci={ci} onOpen={() => setTab('impact')} />
            </div>
            <div className="min-w-0 space-y-5 lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
              <Card>
                <CardHeader>
                  <CardTitle>{t('detail.details')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div:nth-last-child(-n+1)]:border-0 sm:[&>div:nth-last-child(-n+2)]:border-0">
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
                    <Field label={t('fields.created')}>
                      <DateTime date={ci.createdAt} />
                    </Field>
                    <Field label={t('fields.updated')}>
                      <RelativeTime date={ci.updatedAt} />
                    </Field>
                  </dl>
                </CardContent>
              </Card>
              <DescriptionCard ci={ci} />
              <CustomFieldsCard attributes={ci.attributes} />
            </div>
            <div className="min-w-0 space-y-5 lg:col-start-3 lg:row-start-2">
              <RelatedWork ci={ci} />
              <Slot<RecordPanelSlotProps>
                name="core.record.links"
                props={{ record: { type: 'cmdb.ci', id: ci.id } }}
              />
              <Slot<RecordPanelSlotProps>
                name="core.record.files"
                props={{ record: { type: 'cmdb.ci', id: ci.id } }}
              />
            </div>
          </TabsContent>

          <TabsContent value="relationships" className="min-w-0">
            <RelationshipsPanel ciRef={ci.id} canManage={ci.canManage} onAdd={() => setDialog('relate')} />
          </TabsContent>

          <TabsContent value="impact" className="min-w-0">
            <ImpactPanel ci={ci} />
          </TabsContent>
        </Tabs>
      </div>

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
            onOpenChange={(open) => {
              if (!open) remove.reset();
              close(open);
            }}
            title={t('detail.deleteTitle', { name: ci.name })}
            description={t('detail.deleteBody', { count: ci.relationshipCounts.total })}
            confirmLabel={tc('delete')}
            destructive
            loading={remove.isPending}
            onConfirm={() => remove.mutate(undefined)}
            error={remove.error}
          />
        </>
      )}
    </div>
  );
}
