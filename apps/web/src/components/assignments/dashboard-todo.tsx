'use client';

import type { FormAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ArrowRightIcon, ClipboardCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { useApiQuery } from '@/lib/api';
import { TodoRow } from './assignment-badges';

/**
 * The dashboard's "To do" card (core's contribution to `core.dashboard.work`): the person's open assignments, soonest
 * due first. Renders nothing when there are none.
 */
export default function DashboardTodo() {
  const t = useTranslations('assignments');
  const now = useNow({ updateInterval: 60_000 });
  const { data } = useApiQuery<Page<FormAssignment>>('/me/form-assignments', { status: 'open', pageSize: 5 });
  if (!data?.total) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheckIcon className="size-4 text-primary" aria-hidden />
          {t('dashboard.title')}
          <Badge variant="info" className="tabular-nums">
            {t('todo.count', { count: data.total })}
          </Badge>
        </CardTitle>
        <CardDescription>{t('dashboard.description')}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/requests#todo">
              {t('dashboard.open')}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.items.map((a) => (
            <TodoRow key={a.id} a={a} now={now} compact />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
