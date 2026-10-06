'use client';

import { cn } from '@isbp/ui';
import { InfoIcon, TriangleAlertIcon, WrenchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Severity } from '../contracts';

const STYLE: Record<Severity, { icon: typeof InfoIcon; className: string; bar: string }> = {
  info: { icon: InfoIcon, className: 'bg-info/12 text-info', bar: 'bg-info' },
  maintenance: { icon: WrenchIcon, className: 'bg-warning/15 text-warning-foreground', bar: 'bg-warning' },
  incident: {
    icon: TriangleAlertIcon,
    className: 'bg-destructive/10 text-destructive',
    bar: 'bg-destructive',
  },
};

/** Severity is always icon + label + colour — never colour alone. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const t = useTranslations('announcements.severity');
  const { icon: Icon, className: tone } = STYLE[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(severity)}
    </span>
  );
}

export function severityBar(severity: Severity) {
  return STYLE[severity].bar;
}
