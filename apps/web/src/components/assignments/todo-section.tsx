'use client';

import type { FormAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { FadeIn } from '@isbp/ui/motion';
import { ClipboardCheckIcon } from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { useApiQuery } from '@/lib/api';
import { TodoRow } from './assignment-badges';

const FIRST = 5;

/**
 * "To do" in the request portal: forms the person (or one of their groups) was asked to fill in by a date, soonest
 * due first. Hidden when there is nothing to do.
 */
export function TodoSection() {
  const t = useTranslations('assignments.todo');
  const now = useNow({ updateInterval: 60_000 });
  const [state, set] = useListState();
  const all = state.todo === 'all';
  const { data } = useApiQuery<Page<FormAssignment>>('/me/form-assignments', {
    status: 'open',
    pageSize: all ? 100 : FIRST,
  });
  if (!data?.total) return null;
  return (
    <FadeIn>
      <section id="todo" aria-labelledby="todo-title" className="grid scroll-mt-20 gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="todo-title" className="flex items-center gap-2 text-lg font-semibold">
              <ClipboardCheckIcon className="size-5 text-primary" aria-hidden />
              {t('title')}
            </h2>
            <Badge variant="info" className="tabular-nums">
              {t('count', { count: data.total })}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {data.items.map((a) => (
              <TodoRow key={a.id} a={a} now={now} />
            ))}
          </ul>
        </div>
        {data.total > FIRST && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => set({ todo: all ? undefined : 'all' })}>
              {all ? t('showLess') : t('showAll')}
            </Button>
            {!all && (
              <span className="text-sm text-muted-foreground">
                {t('more', { count: data.total - FIRST })}
              </span>
            )}
          </div>
        )}
      </section>
    </FadeIn>
  );
}
