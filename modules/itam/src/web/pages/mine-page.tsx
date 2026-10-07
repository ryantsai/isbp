'use client';

import { useCan, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { KeyRoundIcon, LaptopIcon, LifeBuoyIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { MyAssets } from '../../contracts';
import { AssetStatusBadge, CategoryIcon, WarrantyEnd } from '../badges';
import { modelLabel, useDay } from '../lib';

/** "My devices": what every employee has from IT, with a one-click "Report a problem". */
export default function MyDevicesPage() {
  const t = useTranslations('itam.mine');
  const tt = useTranslations('itam');
  const format = useFormatter();
  const day = useDay();
  const { enabledModules } = usePlatform();
  const canReport = useCan('itsm.tickets.create') && enabledModules.includes('itsm');
  const { data, isLoading } = useApiQuery<MyAssets>('/itam/me/assets');

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="itam-mine-devices" className="space-y-3">
            <h2 id="itam-mine-devices" className="text-lg font-semibold">
              {t('devices', { count: data.devices.length })}
            </h2>
            {data.devices.length === 0 ? (
              <EmptyState
                icon={<LaptopIcon />}
                title={t('noDevices')}
                description={t('noDevicesHint')}
                action={
                  canReport && (
                    <Button variant="outline" asChild>
                      <Link href="/itsm/report">
                        <LifeBuoyIcon /> {t('tellUs')}
                      </Link>
                    </Button>
                  )
                }
              />
            ) : (
              <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.devices.map((d) => (
                  <StaggerItem key={d.id} className="min-w-0">
                    <Card className="h-full">
                      <CardHeader className="flex flex-row items-start gap-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                          <CategoryIcon category={d.category} className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <CardTitle id={`device-${d.id}`} className="truncate text-base">
                            {d.model ? modelLabel(d.model) : tt(`category.${d.category}`)}
                          </CardTitle>
                          <p className="truncate text-sm text-muted-foreground">{d.name}</p>
                        </div>
                        {d.status !== 'deployed' && <AssetStatusBadge status={d.status} />}
                      </CardHeader>
                      <CardContent>
                        <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                          <dt className="text-muted-foreground">{t('tag')}</dt>
                          <dd className="font-mono text-xs leading-5">{d.tag}</dd>
                          <dt className="text-muted-foreground">{t('serial')}</dt>
                          <dd className="truncate font-mono text-xs leading-5">{d.serialNumber ?? '—'}</dd>
                          <dt className="text-muted-foreground">{t('since')}</dt>
                          <dd>
                            {d.since ? format.dateTime(new Date(d.since), { dateStyle: 'medium' }) : '—'}
                          </dd>
                          <dt className="text-muted-foreground">{t('warranty')}</dt>
                          <dd className="min-w-0">
                            <WarrantyEnd date={d.warrantyEnd} state={d.warrantyState} />
                          </dd>
                        </dl>
                      </CardContent>
                      {canReport && (
                        <CardFooter>
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={`/itsm/report?link=${encodeURIComponent(`itam.asset:${d.id}`)}`}
                              aria-label={t('reportFor', { device: d.name })}
                            >
                              <LifeBuoyIcon /> {t('report')}
                            </Link>
                          </Button>
                        </CardFooter>
                      )}
                    </Card>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </section>
          <section aria-labelledby="itam-mine-software" className="space-y-3">
            <h2 id="itam-mine-software" className="text-lg font-semibold">
              {t('software', { count: data.software.length })}
            </h2>
            {data.software.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noSoftware')}</p>
            ) : (
              <Card>
                <CardContent>
                  <ul className="divide-y">
                    {data.software.map((s) => (
                      <li
                        key={`${s.license.id}:${s.device?.id ?? 'me'}`}
                        className="flex min-w-0 items-center gap-3 py-2.5"
                      >
                        <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{s.license.product}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[s.license.publisher, s.device ? t('onDevice', { tag: s.device.tag }) : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        {s.endDate && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t('until', { date: day(s.endDate) })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      )}
    </>
  );
}
