'use client';

import { useTheme } from './theme';
import { Toaster as Sonner, type ToasterProps, toast as sonnerToast } from 'sonner';

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

/**
 * Sonner's `toast`, except that errors stay twice as long (8 s; success and info go after 4 s). Every toast has a
 * close button; important errors also belong inline, next to what failed.
 * Offer "Undo" on reversible quick actions: `toast.success(text, { action: { label: t('undo'), onClick } })`.
 */
export const toast: typeof sonnerToast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  {
    error: ((message, data) =>
      sonnerToast.error(message, { duration: 8000, ...data })) as typeof sonnerToast.error,
  },
);
