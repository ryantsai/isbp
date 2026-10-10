'use client';

import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { Disclosure } from './motion';

const toneClass = {
  destructive: 'border-destructive/30 bg-destructive/8 [&_[data-slot=problem-icon]]:text-destructive',
  warning: 'border-warning/40 bg-warning/10 [&_[data-slot=problem-icon]]:text-warning-foreground',
  info: 'border-info/30 bg-info/8 [&_[data-slot=problem-icon]]:text-info',
} as const;

const icons = { destructive: CircleAlertIcon, warning: TriangleAlertIcon, info: InfoIcon } as const;

/**
 * A failure explained in plain words with one next step: a headline in the reader's language ("The connection to
 * HR database was refused"), what to do (`action`: open the connection, test, retry), and the raw error text
 * behind "Technical details". `live` announces it (for failures that happen while the person watches).
 */
export function ProblemBanner({
  title,
  description,
  action,
  details,
  tone = 'destructive',
  live,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Raw technical text (driver error, stack…), shown collapsed and monospaced. */
  details?: string | null;
  tone?: keyof typeof toneClass;
  live?: boolean;
  className?: string;
}) {
  const t = useTranslations('ui.problem');
  const Icon = icons[tone];
  return (
    <div
      role={live ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        toneClass[tone],
        className,
      )}
    >
      <Icon data-slot="problem-icon" className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{title}</p>
        {description && <div className="text-muted-foreground">{description}</div>}
        {action && <div className="flex flex-wrap items-center gap-2 pt-1">{action}</div>}
        {details && (
          <Disclosure
            summary={t('technicalDetails')}
            triggerClassName="w-auto justify-start py-1 text-xs text-muted-foreground"
          >
            <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-background/70 p-2 font-mono text-xs break-all whitespace-pre-wrap">
              {details}
            </pre>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
