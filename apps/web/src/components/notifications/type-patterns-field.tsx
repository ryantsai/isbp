'use client';

import { typePatternSchema } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@isbp/ui/command';
import { Input } from '@isbp/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { AsteriskIcon, CheckIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  typesMatching,
  useKnownTypes,
  useModuleName,
  usePatternLabel,
  useTypeLabel,
} from './notification-meta';

/**
 * Which notifications a channel receives: pick known types (grouped by module, with "all of module"
 * shortcuts) or type a pattern such as `core.access-request.*`. Shows how many known types are covered.
 */
export function TypePatternsField({
  value,
  onChange,
  id,
  invalid,
  describedBy,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('notifications.admin.channels.form.types');
  const tp = useTranslations('notifications.patterns');
  const typeLabel = useTypeLabel();
  const moduleName = useModuleName();
  const patternLabel = usePatternLabel();
  const known = useKnownTypes();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const customId = useId();

  const modules = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const k of known) map.set(k.moduleId, [...(map.get(k.moduleId) ?? []), k.type]);
    return [...map.entries()];
  }, [known]);
  const knownTypes = known.map((k) => k.type);
  const covered = new Set(value.flatMap((p) => typesMatching(p, knownTypes)));

  const toggle = (pattern: string) =>
    onChange(value.includes(pattern) ? value.filter((p) => p !== pattern) : [...value, pattern]);

  const addCustom = () => {
    const pattern = custom.trim();
    if (!pattern) return;
    if (!typePatternSchema.safeParse(pattern).success) {
      setCustomError(t('patternInvalid'));
      return;
    }
    if (!value.includes(pattern)) onChange([...value, pattern]);
    setCustom('');
    setCustomError(null);
  };

  const item = (pattern: string, label: string, hint?: string) => {
    const selected = value.includes(pattern);
    return (
      <CommandItem key={pattern} value={pattern} keywords={[label]} onSelect={() => toggle(pattern)}>
        <span
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded-[4px] border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
          )}
          aria-hidden
        >
          {selected && <CheckIcon className="size-3 text-primary-foreground" strokeWidth={3} />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{label}</span>
          <code className="truncate font-mono text-[11px] text-muted-foreground">{hint ?? pattern}</code>
        </span>
        <span className="sr-only">{selected ? t('selected') : ''}</span>
      </CommandItem>
    );
  };

  return (
    <div className="space-y-2.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', !value.length && 'text-muted-foreground')}>
              {value.length ? t('selectedCount', { count: value.length }) : t('placeholder')}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={t('search')} />
            <CommandList className="max-h-72">
              <CommandEmpty>{t('noMatch')}</CommandEmpty>
              <CommandGroup heading={t('everything')}>{item('*', tp('all'), '*')}</CommandGroup>
              {modules.map(([moduleId, types]) => (
                <CommandGroup key={moduleId} heading={moduleName(moduleId)}>
                  {item(`${moduleId}.*`, tp('module', { module: moduleName(moduleId) }))}
                  {types.map((type) => item(type, typeLabel(type)))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('chosen')}>
          <AnimatePresence initial={false}>
            {value.map((p) => {
              const label = patternLabel(p);
              return (
                <motion.li
                  key={p}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.12 } }}
                >
                  <Badge variant="secondary" className="max-w-full gap-1 py-0.5 pr-0.5 font-normal" title={p}>
                    {p.includes('*') && <AsteriskIcon aria-hidden />}
                    {label ? (
                      <span className="truncate">{label}</span>
                    ) : (
                      <code className="truncate font-mono text-[11px]">{p}</code>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      aria-label={t('remove', { pattern: label ?? p })}
                      className="ml-0.5 grid size-4 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      <div className="space-y-1">
        <label htmlFor={customId} className="text-xs text-muted-foreground">
          {t('customLabel')}
        </label>
        <div className="flex gap-2">
          <Input
            id={customId}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setCustomError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="core.access-request.*"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(customError) || undefined}
            aria-describedby={customError ? `${customId}-error` : undefined}
            className="h-8 font-mono text-xs"
          />
          <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={!custom.trim()}>
            <PlusIcon /> {t('addPattern')}
          </Button>
        </div>
        {customError && (
          <p id={`${customId}-error`} className="text-xs text-destructive">
            {customError}
          </p>
        )}
      </div>

      {knownTypes.length > 0 && value.length > 0 && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t('coverage', { covered: covered.size, total: knownTypes.length })}
        </p>
      )}
    </div>
  );
}
