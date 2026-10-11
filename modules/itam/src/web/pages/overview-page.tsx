'use client';

import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { useCan } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  ArrowRightIcon,
  CircleCheckIcon,
  ClockAlertIcon,
  CoinsIcon,
  FileTextIcon,
  type LucideIcon,
  PackageIcon,
  PackageSearchIcon,
  ShieldAlertIcon,
  WarehouseIcon,
  WrenchIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import type { AssetStatus, ComplianceSummary, Dashboard } from '../../contracts';
import { CategoryIcon, ComplianceBadge, WarrantyEnd } from '../badges';
import { ChartFrame, DataTableView, HBars, Legend, type SeriesDef, StackedBars } from '../charts';
import { assetHref, contractHref, licenseHref, useMoney } from '../lib';
import { UsageMeter } from '../meters';
import { RenewsIn } from '../renews-in';

const CHART_STATUSES: AssetStatus[] = ['deployed', 'in_stock', 'in_repair', 'ordered', 'lost', 'retired'];
const STATUS_COLOR: Record<string, string> = {
  deployed: 'bg-chart-1',
  in_stock: 'bg-chart-2',
  in_repair: 'bg-chart-3',
  ordered: 'bg-chart-5',
  lost: 'bg-chart-4',
  retired: 'bg-muted-foreground/40',
};

/** A KPI tile (the shared `StatTile`); counts of problems link to the filtered list. */
function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | ReactNode;
  hint?: string;
  href?: string;
  tone?: 'warning' | 'destructive';
}) {
  return (
    <StaggerItem className="h-full">
      <StatTile
        label={label}
        value={value}
        hint={hint}
        href={href}
        icon={<Icon />}
        tone={tone ?? 'info'}
        className="h-full"
      />
    </StaggerItem>
  );
}

function AttentionCard({
  title,
  description,
  href,
  empty,
  children,
}: {
  title: string;
  description: string;
  href: string;
  empty: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('itam.overview');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button
            label={t('viewAll')}
            variant="ghost"
            size="sm"
            endContent={<AstryxIcon icon={ArrowRightIcon} />}
            href={href}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <HStack gap={2} vAlign="center">
            <AstryxIcon icon={CircleCheckIcon} color="success" />
            <Text color="secondary">{t('allClear')}</Text>
          </HStack>
        ) : (
          <List hasDividers density="compact">
            {children}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

/** Assets overview: KPIs, the estate by category and status, spend by vendor and what needs attention. */
export default function OverviewPage() {
  const t = useTranslations('itam');
  const format = useFormatter();
  const money = useMoney();
  const canHardware = useCan('itam.hardware.read');
  const { data, isLoading, error, refetch } = useApiQuery<Dashboard>('/itam/dashboard');
  // Installs that need a decision (no licence, or not allowed): discovery is for the people who manage hardware.
  const canDiscover = useCan('itam.hardware.manage');
  const titles = useApiQuery<{ total: number }>(canDiscover ? '/itam/discovery/titles' : null, {
    pageSize: 1,
  });
  const compliance = useApiQuery<ComplianceSummary>(
    canDiscover ? '/itam/discovery/compliance/summary' : null,
  );
  const needAction =
    titles.data && compliance.data
      ? titles.data.total + compliance.data.unapproved + compliance.data.blocked
      : null;

  const series = useMemo<SeriesDef<AssetStatus>[]>(
    () => CHART_STATUSES.map((s) => ({ key: s, label: t(`status.${s}`), className: STATUS_COLOR[s]! })),
    [t],
  );

  if (!canHardware) return <EmptyState icon={<PackageIcon />} title={t('overview.noAccess')} />;
  if (error) return <ErrorState kind="page" error={error} onRetry={() => refetch()} />;

  const d = data;
  const c = d?.currency ?? 'TWD';
  const statusTotals = d?.assets.byStatus ?? {};
  const inEstate = d ? d.assets.total - (statusTotals.disposed ?? 0) : 0;

  return (
    <>
      <PageHeader title={t('overview.title')} description={t('overview.description')} />
      {isLoading || !d ? (
        <VStack gap={5}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </VStack>
      ) : (
        <VStack gap={5}>
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={PackageIcon}
              label={t('overview.kpi.total')}
              value={inEstate}
              hint={t('overview.kpi.totalHint', { disposed: statusTotals.disposed ?? 0 })}
              href="/itam/hardware"
            />
            <Kpi
              icon={CircleCheckIcon}
              label={t('overview.kpi.deployed')}
              value={statusTotals.deployed ?? 0}
              href="/itam/hardware?view=deployed"
            />
            <Kpi
              icon={WarehouseIcon}
              label={t('overview.kpi.inStock')}
              value={statusTotals.in_stock ?? 0}
              hint={t('overview.kpi.ordered', { count: statusTotals.ordered ?? 0 })}
              href="/itam/hardware?view=in_stock"
            />
            <Kpi
              icon={WrenchIcon}
              label={t('overview.kpi.inRepair')}
              value={statusTotals.in_repair ?? 0}
              href="/itam/hardware?view=in_repair"
              tone={(statusTotals.in_repair ?? 0) > 0 ? 'warning' : undefined}
            />
            <Kpi
              icon={CoinsIcon}
              label={t('overview.kpi.bookValue')}
              value={money(d.assets.bookValue, c, { compact: true })}
              hint={t('overview.kpi.bookValueHint', {
                cost: money(d.assets.purchaseCost, c, { compact: true }),
              })}
            />
            <Kpi
              icon={ClockAlertIcon}
              label={t('overview.kpi.warranties')}
              value={d.warranties.expiring30}
              hint={t('overview.kpi.warrantiesHint', {
                count: d.warranties.expiring90,
                expired: d.warranties.expired,
              })}
              href="/itam/hardware?warranty=expiring"
              tone={d.warranties.expiring30 > 0 ? 'warning' : undefined}
            />
            {d.software && (
              <Kpi
                icon={ShieldAlertIcon}
                label={t('overview.kpi.nonCompliant')}
                value={d.software.nonCompliant}
                hint={t('overview.kpi.nonCompliantHint', { total: d.software.total })}
                href="/itam/software?view=attention"
                tone={d.software.nonCompliant > 0 ? 'destructive' : undefined}
              />
            )}
            {needAction !== null && (
              <Kpi
                icon={PackageSearchIcon}
                label={t('overview.kpi.installs')}
                value={needAction}
                hint={t('overview.kpi.installsHint', {
                  unlicensed: titles.data?.total ?? 0,
                  notAllowed: (compliance.data?.unapproved ?? 0) + (compliance.data?.blocked ?? 0),
                })}
                href={titles.data?.total ? '/itam/discovery' : '/itam/discovery?tab=compliance'}
                tone={needAction > 0 ? 'destructive' : undefined}
              />
            )}
            {d.contracts && (
              <Kpi
                icon={FileTextIcon}
                label={t('overview.kpi.renewing')}
                value={d.contracts.renewing90}
                hint={t('overview.kpi.renewingHint', {
                  cost: money(d.contracts.renewing90AnnualCost, c, { compact: true }),
                })}
                href="/itam/contracts?view=renewing"
                tone={d.contracts.renewing90 > 0 ? 'warning' : undefined}
              />
            )}
          </Stagger>

          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartFrame
              title={t('overview.byCategory')}
              description={t('overview.byCategoryHint')}
              legend={<Legend series={series} totals={statusTotals} />}
              chart={
                <StackedBars
                  ariaLabel={t('overview.byCategory')}
                  series={series}
                  rows={d.assets.byCategory.map((r) => ({
                    key: r.category,
                    text: t(`category.${r.category}`),
                    label: (
                      <HStack gap={1.5} vAlign="center">
                        <CategoryIcon category={r.category} />
                        <Text maxLines={1}>{t(`category.${r.category}`)}</Text>
                      </HStack>
                    ),
                    counts: r.byStatus,
                  }))}
                />
              }
              table={
                <DataTableView
                  caption={t('overview.byCategory')}
                  head={[
                    t('fields.category'),
                    ...CHART_STATUSES.map((s) => t(`status.${s}`)),
                    t('overview.total'),
                  ]}
                  rows={d.assets.byCategory.map((r) => ({
                    key: r.category,
                    cells: [
                      t(`category.${r.category}`),
                      ...CHART_STATUSES.map((s) => format.number(r.byStatus[s] ?? 0)),
                      format.number(r.total - (r.byStatus.disposed ?? 0)),
                    ],
                  }))}
                />
              }
            />
            {d.spendByVendor ? (
              <ChartFrame
                title={t('overview.spend')}
                description={t('overview.spendHint')}
                chart={
                  d.spendByVendor.length ? (
                    <HBars
                      ariaLabel={t('overview.spend')}
                      formatValue={(v) => money(v, c, { compact: true })}
                      items={d.spendByVendor.map((s) => ({
                        key: s.vendor.id,
                        label: s.vendor.name,
                        text: s.vendor.name,
                        value: s.amount,
                      }))}
                    />
                  ) : (
                    <Text color="secondary">{t('overview.noSpend')}</Text>
                  )
                }
                table={
                  <DataTableView
                    caption={t('overview.spend')}
                    head={[t('fields.vendor'), t('overview.amount', { currency: c })]}
                    rows={d.spendByVendor.map((s) => ({
                      key: s.vendor.id,
                      cells: [s.vendor.name, money(s.amount, c)],
                    }))}
                  />
                }
              />
            ) : (
              <ChartFrame
                title={t('overview.byStatus')}
                chart={
                  <StackedBars
                    ariaLabel={t('overview.byStatus')}
                    series={series}
                    rows={[
                      {
                        key: 'all',
                        text: t('overview.total'),
                        label: t('overview.total'),
                        counts: statusTotals,
                      },
                    ]}
                  />
                }
                table={
                  <DataTableView
                    caption={t('overview.byStatus')}
                    head={[t('fields.status'), t('overview.total')]}
                    rows={CHART_STATUSES.map((s) => ({
                      key: s,
                      cells: [t(`status.${s}`), statusTotals[s] ?? 0],
                    }))}
                  />
                }
              />
            )}
          </div>

          <section aria-labelledby="itam-attention">
            <VStack gap={3}>
              <Heading level={2} id="itam-attention">
                {t('overview.attention')}
              </Heading>
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <AttentionCard
                  title={t('overview.warrantiesTitle')}
                  description={t('overview.warrantiesHint')}
                  href="/itam/hardware?warranty=expiring"
                  empty={!d.attention.warranties.length}
                >
                  {d.attention.warranties.map((a) => (
                    <ListItem
                      key={a.id}
                      label={a.name}
                      href={assetHref(a)}
                      startContent={<CategoryIcon category={a.category} color="secondary" label />}
                      description={
                        <HStack gap={2} wrap="wrap" vAlign="center">
                          <Text type="code" size="xsm" color="secondary">
                            {a.tag}
                          </Text>
                          <WarrantyEnd date={a.warrantyEnd} state={a.warrantyState} />
                          {a.assignee && <Text type="supporting">· {a.assignee.displayName}</Text>}
                        </HStack>
                      }
                    />
                  ))}
                </AttentionCard>
                {d.attention.contracts && (
                  <AttentionCard
                    title={t('overview.contractsTitle')}
                    description={t('overview.contractsHint')}
                    href="/itam/contracts?view=renewing"
                    empty={!d.attention.contracts.length}
                  >
                    {d.attention.contracts.map((x) => (
                      <ListItem
                        key={x.id}
                        label={x.title}
                        href={contractHref(x)}
                        description={
                          <HStack gap={2} wrap="wrap" vAlign="center">
                            <Text type="code" size="xsm" color="secondary">
                              {x.reference}
                            </Text>
                            <RenewsIn c={x} />
                            <Text type="supporting">· {money(x.annualCost, x.currency)}</Text>
                          </HStack>
                        }
                      />
                    ))}
                  </AttentionCard>
                )}
                {d.attention.licenses && (
                  <AttentionCard
                    title={t('overview.licensesTitle')}
                    description={t('overview.licensesHint')}
                    href="/itam/software?view=attention"
                    empty={!d.attention.licenses.length}
                  >
                    {d.attention.licenses.map((l) => (
                      <ListItem
                        key={l.id}
                        label={l.product}
                        href={licenseHref(l)}
                        endContent={<ComplianceBadge state={l.complianceState} />}
                        description={<UsageMeter used={l.used} quantity={l.quantity} />}
                      />
                    ))}
                  </AttentionCard>
                )}
              </div>
            </VStack>
          </section>
          {d.otherCurrencies > 0 && (
            <Text as="p" type="supporting">
              {t('overview.otherCurrencies', { count: d.otherCurrencies, currency: c })}
            </Text>
          )}
        </VStack>
      )}
    </>
  );
}
