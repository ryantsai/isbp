'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { useCan } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Meter } from '@isbp/ui/meter';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dashboard } from '../../contracts';
import { ReviewStatusBadge } from '../badges';
import { reviewHref, stocktakeHref, useDay } from '../lib';

/**
 * The home card for the people who run information security: assets by value, stocktakes and account reviews in
 * progress. People who only take part (their checks, reviews and passwords to change) find those on My work, so they
 * get no card here. Nothing to show: no card.
 */
export default function IsmsDashboardCard() {
  const readsAssets = useCan('isms.assets.read');
  const runsStocktakes = useCan('isms.stocktakes.manage');
  const readsReviews = useCan('isms.reviews.read');
  const runsReviews = useCan('isms.reviews.manage');
  if (!readsAssets && !runsStocktakes && !readsReviews && !runsReviews) return null;
  return <IsmsOverviewCard />;
}

function IsmsOverviewCard() {
  const t = useTranslations('isms.dashboard');
  const day = useDay();
  const { data, isLoading } = useApiQuery<Dashboard>('/isms/dashboard');
  if (isLoading)
    return (
      <Card className="min-w-0">
        <CardContent>
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  if (!data) return null;
  const empty = !data.assets?.total && !data.stocktakes.length && !data.reviews.length;
  if (empty) return null;
  const max = Math.max(1, ...(data.assets?.byValue.map((v) => v.count) ?? [1]));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon icon={ShieldCheckIcon} color="accent" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button
            label={t('open')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href={data.assets ? '/isms' : '/isms/stocktakes'}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <VStack gap={4}>
          {data.assets && data.assets.total > 0 && (
            <VStack as="section" gap={1.5} aria-labelledby="isms-dash-value">
              <Text type="label" color="secondary" id="isms-dash-value">
                {t('byValue', { total: data.assets.total })}
              </Text>
              <List density="compact" header={<span className="sr-only">{t('byValueCaption')}</span>}>
                {[...data.assets.byValue].reverse().map((v) => (
                  <ListItem
                    key={v.value}
                    label={t('value', { value: v.value })}
                    description={
                      <Meter
                        value={v.count}
                        max={max}
                        label={t('value', { value: v.value })}
                        valueText={String(v.count)}
                        size="sm"
                      />
                    }
                    endContent={<Text hasTabularNumbers>{v.count}</Text>}
                  />
                ))}
              </List>
            </VStack>
          )}
          {data.stocktakes.length > 0 && (
            <VStack as="section" gap={1} aria-labelledby="isms-dash-st">
              <Text type="label" color="secondary" id="isms-dash-st">
                {t('stocktakes')}
              </Text>
              <List density="compact" hasDividers>
                {data.stocktakes.map((s) => (
                  <ListItem
                    key={s.id}
                    label={s.name}
                    href={stocktakeHref(s.reference)}
                    endContent={
                      <HStack gap={2} vAlign="center">
                        <Text type="supporting" hasTabularNumbers>
                          {t('percent', { percent: s.percent })}
                        </Text>
                        <Text type="supporting" className="hidden sm:inline">
                          {day(s.dueOn)}
                        </Text>
                      </HStack>
                    }
                  />
                ))}
              </List>
            </VStack>
          )}
          {data.reviews.length > 0 && (
            <VStack as="section" gap={1} aria-labelledby="isms-dash-rv">
              <Text type="label" color="secondary" id="isms-dash-rv">
                {t('reviews')}
              </Text>
              <List density="compact" hasDividers>
                {data.reviews.map((r) => (
                  <ListItem
                    key={r.id}
                    label={r.target}
                    href={reviewHref(r.reference)}
                    endContent={
                      <HStack gap={2} vAlign="center">
                        <Text type="supporting" hasTabularNumbers>
                          {t('percent', { percent: r.percent })}
                        </Text>
                        <ReviewStatusBadge status={r.status} />
                      </HStack>
                    }
                  />
                ))}
              </List>
            </VStack>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
