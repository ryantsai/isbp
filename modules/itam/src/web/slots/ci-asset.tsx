'use client';

import type { CiRelatedSlotProps } from '@isbp/module-cmdb/contracts';
import type { Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AssetListItem } from '../../contracts';
import { AssetStatusBadge, WarrantyEnd } from '../badges';
import { assetHref, modelLabel, useMoney } from '../lib';

/** `cmdb.ci.related`: the hardware asset record behind a CI (tag, model, status, warranty, assignee, book value). */
export default function CiAssetRecord({ ci }: CiRelatedSlotProps) {
  const t = useTranslations('itam.ciSlot');
  const money = useMoney();
  const { data, isLoading } = useApiQuery<Page<AssetListItem>>('/itam/assets', { ci: ci.id, pageSize: 3 });
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2" aria-labelledby={`itam-ci-${ci.id}`}>
      <h3 id={`itam-ci-${ci.id}`} className="flex items-center gap-2 text-sm font-semibold">
        <PackageIcon className="size-4 text-primary" aria-hidden />
        {t('title')}
      </h3>
      <ul className="grid gap-3">
        {items.map((a) => (
          <li key={a.id} className="grid min-w-0 gap-2 rounded-lg border p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link
                href={assetHref(a)}
                className="font-mono text-xs font-medium hover:underline focus-visible:underline"
              >
                {a.tag}
              </Link>
              <span className="min-w-0 flex-1 truncate">{a.model ? modelLabel(a.model) : a.name}</span>
              <AssetStatusBadge status={a.status} />
            </div>
            <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('serial')}</dt>
              <dd className="truncate font-mono">{a.serialNumber ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('warranty')}</dt>
              <dd className="min-w-0">
                <WarrantyEnd date={a.warrantyEnd} state={a.warrantyState} />
              </dd>
              <dt className="text-muted-foreground">{t('assignee')}</dt>
              <dd className="min-w-0">
                {a.assignee ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <UserAvatar
                      name={a.assignee.displayName}
                      src={a.assignee.avatarUrl}
                      className="size-4 text-[8px]"
                    />
                    <span className="truncate">{a.assignee.displayName}</span>
                  </span>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-muted-foreground">{t('bookValue')}</dt>
              <dd className="tabular-nums">{money(a.bookValue, a.currency)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
