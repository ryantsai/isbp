'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { ArrowRightIcon, CircleAlertIcon, EyeIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type Preview, type PreviewAction } from '../../contracts';
import { DIRECTION_ICON } from '../badges';
import { showValue } from '../lib';

const ACTION_TONE: Record<PreviewAction, 'info' | 'success' | 'warning' | 'muted' | 'destructive'> = {
  create: 'success',
  link: 'info',
  update: 'info',
  push: 'info',
  remoteCreate: 'success',
  conflict: 'warning',
  skip: 'muted',
  orphan: 'muted',
};

/** The dry run: per record what would happen, and per field the value before → after. */
export function PreviewPanel({ preview, system }: { preview: Preview; system: string }) {
  const t = useTranslations('integrations.preview');
  const tn = useTranslations('integrations.preview.notes');
  if (!preview.items.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <EyeIcon className="size-4" aria-hidden />
        {preview.source === 'remote' ? t('nothingRemote', { system }) : t('nothingLocal')}
      </p>
    );
  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm text-muted-foreground">
        {preview.source === 'remote'
          ? t('fromRemote', { count: preview.items.length, system })
          : t('fromLocal', { count: preview.items.length })}
        {preview.hasMore && ` ${t('more')}`}
      </p>
      <ul className="grid min-w-0 gap-2">
        {preview.items.map((item, i) => (
          <li key={item.remoteId ?? item.localId ?? i} className="min-w-0 rounded-lg border p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {item.remoteRef && (
                <span className="font-mono text-xs text-muted-foreground">{item.remoteRef}</span>
              )}
              <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
              {item.localTitle && (
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <ArrowRightIcon className="size-3" aria-hidden />
                  <span className="truncate">{item.localTitle}</span>
                </span>
              )}
              <span className="flex flex-wrap gap-1 sm:ml-auto">
                {item.actions.map((a) => (
                  <Badge key={a} variant={ACTION_TONE[a]}>
                    {t(`actions.${a}`, { system })}
                  </Badge>
                ))}
              </span>
            </div>
            {item.error && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {item.error.message}
              </p>
            )}
            {item.notes.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {item.notes
                  .map((n) => {
                    const key = n.startsWith('unmappable:') ? 'unmappable' : n;
                    return tn.has(key) ? tn(key, { field: n.split(':')[1] ?? '' }) : n;
                  })
                  .join(' · ')}
              </p>
            )}
            {item.changes.length > 0 && (
              <dl className="mt-2 grid min-w-0 gap-1 text-xs">
                {item.changes.map((c) => {
                  const Icon =
                    DIRECTION_ICON[
                      c.direction === 'push' ? 'push' : c.direction === 'pull' ? 'pull' : 'both'
                    ];
                  return (
                    <div
                      key={c.field}
                      className="grid min-w-0 grid-cols-[auto_minmax(0,8rem)_minmax(0,1fr)] items-start gap-2"
                    >
                      <Icon
                        className={cn(
                          'mt-0.5 size-3.5',
                          c.direction === 'conflict' ? 'text-warning-foreground' : 'text-primary',
                        )}
                        aria-hidden
                      />
                      <dt className="truncate font-mono">
                        <span className="sr-only">{t(`direction.${c.direction}`, { system })} </span>
                        {c.field}
                      </dt>
                      <dd className="min-w-0 wrap-anywhere">
                        <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                          {showValue(c.before) || t('empty')}
                        </span>{' '}
                        <ArrowRightIcon className="inline size-3" aria-hidden />
                        <span className="sr-only"> {t('becomes')} </span>{' '}
                        <span>{showValue(c.after) || t('empty')}</span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
