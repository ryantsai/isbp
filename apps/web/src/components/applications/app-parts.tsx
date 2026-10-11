'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import type { Application } from '@isbp/contracts';
import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { toast } from '@isbp/ui/toast';
import { CheckIcon, CopyIcon, LayoutGridIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** Paths refreshed after anything changes an application, its roles or its grants. */
export const APP_INVALIDATE = [
  '/applications',
  '/role-query',
  '/api-clients',
  '/role-assignments',
  '/audit-logs',
  '/platform/dashboard',
];

/** Global grant check (`useCan` without a resource means "anywhere"). */
export function useCanGlobal(permission: string) {
  const { permissions } = usePlatform();
  return permissions.can(permission);
}

/** Translated name/description for the system app (the platform itself). */
export function useAppText() {
  const t = useTranslations('applications.platform');
  const tc = useTranslations('common');
  return useCallback(
    (app: Pick<Application, 'name' | 'description' | 'isSystem'>) =>
      app.isSystem
        ? { name: tc('appName'), description: t('description') }
        : { name: app.name, description: app.description },
    [t, tc],
  );
}

/** "Finance ERP" → "FE", "人事系統" → "人事". */
export function appInitials(name: string) {
  const words = name
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (!words.length) return '?';
  const latin = /^[A-Za-z0-9]/;
  if (words.length > 1 && latin.test(words[0]!) && latin.test(words[1]!))
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return [...words[0]!].slice(0, 2).join('').toUpperCase();
}

function hueOf(value: string) {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Initials tile with a stable, theme-aware tint per application key; the platform gets its own mark. */
export function AppTile({
  app,
  size = 'md',
  className,
}: {
  app: Pick<Application, 'key' | 'name' | 'isSystem'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims =
    size === 'lg'
      ? 'size-14 rounded-xl text-lg'
      : size === 'sm'
        ? 'size-8 rounded-md text-[11px]'
        : 'size-11 rounded-lg text-sm';
  if (app.isSystem) {
    return (
      <span
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center bg-primary text-primary-foreground shadow-sm',
          dims,
          className,
        )}
      >
        <LayoutGridIcon className={size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5'} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{ ['--h' as string]: hueOf(app.key) }}
      className={cn(
        'grid shrink-0 place-items-center font-semibold tracking-tight',
        'bg-[oklch(0.94_0.04_var(--h))] text-[oklch(0.4_0.11_var(--h))] dark:bg-[oklch(0.32_0.06_var(--h))] dark:text-[oklch(0.9_0.06_var(--h))]',
        dims,
        className,
      )}
    >
      {appInitials(app.name)}
    </span>
  );
}

/** Icon button that copies `value`, with a check-mark confirmation. */
export function CopyButton({
  value,
  label,
  className,
  variant = 'ghost',
}: {
  value: string;
  label: string;
  className?: string;
  variant?: 'ghost' | 'outline';
}) {
  const t = useTranslations('applications.copy');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(h);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(tc('copied'));
    } catch {
      toast.error(t('failed'));
    }
  };
  return (
    <IconButton
      label={label}
      variant={variant === 'outline' ? 'secondary' : 'ghost'}
      size="sm"
      icon={<Icon icon={copied ? CheckIcon : CopyIcon} color={copied ? 'success' : 'inherit'} />}
      onClick={copy}
      className={cn('shrink-0', className)}
    />
  );
}

/** Monospace snippet with a copy button; long lines scroll horizontally inside the block. */
export function CodeBlock({
  code,
  label,
  copyLabel,
  className,
}: {
  code: string;
  /** Caption above the block (also names the copy button). */
  label?: string;
  copyLabel: string;
  className?: string;
}) {
  return (
    <figure className={cn('min-w-0 space-y-1.5', className)}>
      {label && <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>}
      <div className="group/code relative rounded-lg border bg-muted/40">
        <pre className="overflow-x-auto px-3 py-2.5 pr-11 font-mono text-xs leading-relaxed whitespace-pre">
          <code>{code}</code>
        </pre>
        <CopyButton
          value={code}
          label={copyLabel}
          className="absolute top-1 right-1 bg-background/80 backdrop-blur"
        />
      </div>
    </figure>
  );
}

const noop = () => () => {};

/** `window.location.origin` after hydration ('' on the server, so markup matches). */
export function useOrigin() {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => '',
  );
}

/** Quote a value for a POSIX shell (single quotes; embedded quotes escaped). */
export function shellQuote(value: string) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
