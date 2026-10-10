'use client';

import { type AppPermission, appPermissionPatternSchema } from '@isbp/contracts';
import { matchPermission } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@isbp/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { AsteriskIcon, CheckIcon, PlusIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

export const isAppPattern = (value: string) => appPermissionPatternSchema.safeParse(value).success;

/** Catalog keys a pattern covers (exact keys cover themselves). */
export function coveredKeys(pattern: string, catalog: readonly AppPermission[]) {
  return catalog.filter((p) => matchPermission(pattern, p.key)).map((p) => p.key);
}

/** A permission or pattern chip; wildcards get an asterisk glyph and their reach as a tooltip. */
export function PermissionChip({
  value,
  catalog,
  onRemove,
  removeLabel,
  className,
}: {
  value: string;
  catalog?: readonly AppPermission[];
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  const t = useTranslations('applications.permissionPicker');
  const wildcard = value.includes('*');
  const covers = wildcard && catalog ? coveredKeys(value, catalog).length : null;
  const unknown = !wildcard && catalog && !catalog.some((p) => p.key === value);
  return (
    <span
      title={covers !== null ? t('covers', { count: covers }) : unknown ? t('notInCatalog') : undefined}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
        wildcard ? 'border-primary/30 bg-primary/5 text-primary' : 'bg-muted text-muted-foreground',
        unknown && 'border-dashed',
        className,
      )}
    >
      {wildcard && <AsteriskIcon className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{value}</span>
      {covers !== null && <span className="sr-only">({t('covers', { count: covers })})</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-0.5 rounded-sm p-0.5 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Searchable multi-select over the application's permission catalog that also takes wildcard patterns
 * (`invoices.*`) — typed freely or picked from the suggested "everything under…" groups.
 */
export function AppPermissionPicker({
  catalog,
  value,
  onChange,
  id,
  describedBy,
  disabled,
}: {
  catalog: readonly AppPermission[];
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('applications.permissionPicker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const prefixes = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of catalog) {
      const segs = p.key.split('.');
      for (let i = 1; i < segs.length; i++) {
        const pattern = `${segs.slice(0, i).join('.')}.*`;
        out.set(pattern, (out.get(pattern) ?? 0) + 1);
      }
    }
    return [...out.entries()].filter(([, n]) => n > 1).map(([pattern, n]) => ({ pattern, n }));
  }, [catalog]);

  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((v) => v !== key) : [...value, key]);
  const impliedBy = (key: string) =>
    value.find((v) => v !== key && v.includes('*') && matchPermission(v, key));

  const typed = needle && isAppPattern(needle) && !value.includes(needle) ? needle : null;
  const typedIsCatalog = typed !== null && catalog.some((p) => p.key === typed);
  const typedIsPrefix = typed !== null && prefixes.some((p) => p.pattern === typed);
  const shownPrefixes = prefixes.filter((p) => !needle || p.pattern.includes(needle));
  const shownCatalog = catalog.filter(
    (p) => !needle || p.key.includes(needle) || p.description.toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 dark:bg-input/30',
          disabled && 'opacity-50',
        )}
      >
        <AnimatePresence initial={false}>
          {value.map((v) => (
            <motion.span
              key={v}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.15 }}
              className="max-w-full"
            >
              <PermissionChip
                value={v}
                catalog={catalog}
                onRemove={disabled ? undefined : () => toggle(v)}
                removeLabel={t('remove', { permission: v })}
              />
            </motion.span>
          ))}
        </AnimatePresence>
        {value.length === 0 && <span className="px-1 text-sm text-muted-foreground">{t('none')}</span>}
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQ('');
          }}
        >
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-describedby={describedBy}
              className="ml-auto h-7 text-muted-foreground"
            >
              <PlusIcon /> {t('add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-0" align="end">
            <Command shouldFilter={false}>
              <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
              <CommandList className="max-h-80">
                <CommandEmpty>{catalog.length ? t('noMatch') : t('emptyCatalog')}</CommandEmpty>
                {typed && !typedIsCatalog && !typedIsPrefix && (
                  <CommandGroup heading={t('custom')}>
                    <CommandItem
                      value={`add:${typed}`}
                      onSelect={() => {
                        toggle(typed);
                        setQ('');
                      }}
                    >
                      <PlusIcon />
                      <code className="font-mono text-xs">{typed}</code>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {typed.includes('*')
                          ? t('covers', { count: coveredKeys(typed, catalog).length })
                          : t('notInCatalog')}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                )}
                {shownPrefixes.length > 0 && (
                  <CommandGroup heading={t('wildcards')}>
                    {shownPrefixes.map(({ pattern, n }) => {
                      const on = value.includes(pattern);
                      return (
                        <CommandItem key={pattern} value={`w:${pattern}`} onSelect={() => toggle(pattern)}>
                          <AsteriskIcon className="text-primary" />
                          <code className="font-mono text-xs">{pattern}</code>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {t('covers', { count: n })}
                          </span>
                          <CheckIcon className={cn('size-4', on ? 'opacity-100' : 'opacity-0')} aria-hidden />
                          <span className="sr-only">{on ? t('selected') : t('notSelected')}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
                {shownCatalog.length > 0 && (
                  <CommandGroup heading={t('catalog')}>
                    {shownCatalog.map((p) => {
                      const on = value.includes(p.key);
                      const via = on ? undefined : impliedBy(p.key);
                      return (
                        <CommandItem key={p.id} value={`p:${p.key}`} onSelect={() => toggle(p.key)}>
                          <div className="min-w-0 flex-1">
                            <code className="block truncate font-mono text-xs">{p.key}</code>
                            <span className="block truncate text-xs text-muted-foreground">
                              {via ? t('includedBy', { pattern: via }) : p.description || '—'}
                            </span>
                          </div>
                          <CheckIcon
                            className={cn('size-4', on ? 'opacity-100' : via ? 'opacity-40' : 'opacity-0')}
                            aria-hidden
                          />
                          <span className="sr-only">
                            {on ? t('selected') : via ? t('includedBy', { pattern: via }) : t('notSelected')}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('typeHint')}</p>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
