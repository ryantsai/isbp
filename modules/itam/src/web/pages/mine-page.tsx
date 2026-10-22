'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { PageHeader } from '@isbp/ui/page-header';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { KeyRoundIcon, LaptopIcon, LifeBuoyIcon, PackagePlusIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { MyAssets } from '../../contracts';
import { AssetStatusBadge, CategoryIcon, WarrantyEnd } from '../badges';
import { modelLabel, useDay } from '../lib';

/** "My devices": what every employee has from IS, with a one-click "Report a problem". */
export default function MyDevicesPage() {
  const t = useTranslations('itam.mine');
  const tt = useTranslations('itam');
  const format = useFormatter();
  const day = useDay();
  const { enabledModules } = usePlatform();
  const canReport = useCan('itsm.tickets.create') && enabledModules.includes('itsm');
  const { data, isLoading, error, refetch } = useApiQuery<MyAssets>('/itam/me/assets');

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {error ? (
        <ErrorState kind="page" error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : (
        <VStack gap={5}>
          <section aria-labelledby="itam-mine-devices">
            <VStack gap={3}>
              <Heading level={2} id="itam-mine-devices">
                {t('devices', { count: data.devices.length })}
              </Heading>
              {data.devices.length === 0 ? (
                <EmptyState
                  icon={<LaptopIcon />}
                  title={t('noDevices')}
                  description={t('noDevicesHint')}
                  action={
                    canReport && (
                      <Button
                        label={t('tellUs')}
                        variant="secondary"
                        icon={<Icon icon={LifeBuoyIcon} />}
                        href="/itsm/report"
                      />
                    )
                  }
                />
              ) : (
                <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {data.devices.map((d) => (
                    <StaggerItem key={d.id} className="min-w-0">
                      <Card className="h-full">
                        <CardHeader className="flex flex-row items-start gap-3">
                          <IconTile size="lg" aria-hidden>
                            <CategoryIcon category={d.category} />
                          </IconTile>
                          <div className="min-w-0 flex-1">
                            <CardTitle id={`device-${d.id}`} className="wrap-break-word">
                              {d.model ? modelLabel(d.model) : tt(`category.${d.category}`)}
                            </CardTitle>
                            <Text as="p" type="supporting">
                              {d.name}
                            </Text>
                          </div>
                          {d.status !== 'deployed' && <AssetStatusBadge status={d.status} />}
                        </CardHeader>
                        <CardContent>
                          <MetadataList label={{ position: 'start', width: 104 }}>
                            <MetadataListItem label={t('tag')}>
                              <Text type="code">{d.tag}</Text>
                            </MetadataListItem>
                            <MetadataListItem label={t('serial')}>
                              <Text type="code">{d.serialNumber ?? '—'}</Text>
                            </MetadataListItem>
                            <MetadataListItem label={t('since')}>
                              {d.since ? format.dateTime(new Date(d.since), { dateStyle: 'medium' }) : '—'}
                            </MetadataListItem>
                            <MetadataListItem label={t('warranty')}>
                              <WarrantyEnd date={d.warrantyEnd} state={d.warrantyState} />
                            </MetadataListItem>
                          </MetadataList>
                        </CardContent>
                        {canReport && (
                          <CardFooter>
                            <Button
                              label={t('report')}
                              variant="secondary"
                              size="sm"
                              icon={<Icon icon={LifeBuoyIcon} />}
                              href={`/itsm/report?link=${encodeURIComponent(`itam.asset:${d.id}`)}`}
                              aria-label={t('reportFor', { device: d.name })}
                            />
                          </CardFooter>
                        )}
                      </Card>
                    </StaggerItem>
                  ))}
                </Stagger>
              )}
            </VStack>
          </section>
          <section aria-labelledby="itam-mine-software">
            <VStack gap={3}>
              <Heading level={2} id="itam-mine-software">
                {t('software', { count: data.software.length })}
              </Heading>
              {data.software.length === 0 ? (
                <Text color="secondary">{t('noSoftware')}</Text>
              ) : (
                <Card>
                  <CardContent>
                    <List hasDividers density="compact">
                      {data.software.map((s) => (
                        <ListItem
                          key={`${s.license.id}:${s.device?.id ?? 'me'}`}
                          label={s.license.product}
                          startContent={<Icon icon={KeyRoundIcon} color="secondary" />}
                          description={
                            [s.license.publisher, s.device ? t('onDevice', { tag: s.device.tag }) : null]
                              .filter(Boolean)
                              .join(' · ') || undefined
                          }
                          endContent={
                            s.endDate ? (
                              <Text type="supporting">{t('until', { date: day(s.endDate) })}</Text>
                            ) : undefined
                          }
                        />
                      ))}
                    </List>
                  </CardContent>
                </Card>
              )}
            </VStack>
          </section>
          {data.devices.length > 0 && (
            <section aria-labelledby="itam-mine-help">
              <Card>
                <CardContent>
                  <HStack gap={3} wrap="wrap" hAlign="between" vAlign="center">
                    <StackItem size="fill">
                      <VStack>
                        <Heading level={4} accessibilityLevel={2} id="itam-mine-help">
                          {t('helpTitle')}
                        </Heading>
                        <Text color="secondary">{t('helpHint')}</Text>
                      </VStack>
                    </StackItem>
                    <HStack gap={2} wrap="wrap">
                      {canReport && (
                        <Button
                          label={t('tellUs')}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={LifeBuoyIcon} />}
                          href="/itsm/report"
                        />
                      )}
                      <Button
                        label={t('requestDevice')}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={PackagePlusIcon} />}
                        href="/requests"
                      />
                    </HStack>
                  </HStack>
                </CardContent>
              </Card>
            </section>
          )}
        </VStack>
      )}
    </>
  );
}
