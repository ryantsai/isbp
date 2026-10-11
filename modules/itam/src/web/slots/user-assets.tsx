'use client';

import type { UserOverviewSlotProps } from '@isbp/contracts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, KeyRoundIcon, PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Holdings } from '../../contracts';
import { AssetStatusBadge, CategoryIcon } from '../badges';
import { assetHref, licenseHref, modelLabel } from '../lib';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/** `core.user.overview`: the devices and software assigned to a person (Administration → People). */
export default function UserAssets({ user }: UserOverviewSlotProps) {
  const t = useTranslations('itam.userSlot');
  const { data, isLoading } = useApiQuery<Holdings>(`/itam/people/${user.id}/holdings`);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description', { name: user.displayName })}</CardDescription>
        <CardAction>
          <Button
            label={t('open')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href={`/itam/hardware?assignee=${user.id}`}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t('devices', { count: data.assets.length })}
              </h3>
              {data.assets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noDevices')}</p>
              ) : (
                <ul className="divide-y">
                  {data.assets.map((a) => (
                    <li key={a.id} className="flex min-w-0 items-center gap-2 py-2 text-sm">
                      <CategoryIcon category={a.category} className="text-muted-foreground" label />
                      <Link
                        href={assetHref(a)}
                        className="font-mono text-xs text-muted-foreground hover:underline"
                      >
                        {a.tag}
                      </Link>
                      <span className="min-w-0 flex-1 truncate">
                        {a.model ? modelLabel(a.model) : a.name}
                      </span>
                      <AssetStatusBadge status={a.status} className="hidden sm:inline-flex" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data.licenses && (
              <div className="grid gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t('software', { count: data.licenses.length })}
                </h3>
                {data.licenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noSoftware')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {data.licenses.map((l) => (
                      <li key={l.id}>
                        <Link
                          href={licenseHref(l)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                        >
                          <KeyRoundIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{l.product}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
