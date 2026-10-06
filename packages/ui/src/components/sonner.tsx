'use client';

import { useTheme } from './theme';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function richColor(kind: string, color: string) {
  return {
    [`--${kind}-bg`]: `color-mix(in oklab, ${color} 8%, var(--popover))`,
    [`--${kind}-border`]: `color-mix(in oklab, ${color} 25%, var(--popover))`,
    [`--${kind}-text`]: color,
  };
}

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={(resolvedTheme as ToasterProps['theme']) ?? 'system'}
      className="toaster group"
      richColors
      closeButton
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          // Rich colours from our status tokens: Sonner's defaults miss WCAG AA contrast.
          ...richColor('success', 'var(--success)'),
          ...richColor('info', 'var(--info)'),
          ...richColor('warning', 'var(--warning-foreground)'),
          ...richColor('error', 'var(--destructive)'),
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { toast } from 'sonner';
