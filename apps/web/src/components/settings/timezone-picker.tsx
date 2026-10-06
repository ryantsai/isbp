'use client';

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
import { Spinner } from '@isbp/ui/spinner';
import { CheckIcon, ChevronsUpDownIcon, GlobeIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

function allZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC'];
  }
}

/** "GMT+8" style offset for a zone right now (empty if the runtime can't tell). */
export function zoneOffset(zone: string, at = new Date()): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

const pretty = (zone: string) => zone.replaceAll('_', ' ');

/** Searchable IANA time-zone picker (Popover + Command). */
export function TimezonePicker({
  id,
  value,
  onChange,
  pending,
}: {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations('settings.preferences.timezone');
  const [open, setOpen] = useState(false);
  // Offsets are computed lazily (≈400 zones) the first time the list opens.
  const zones = useMemo(
    () => (open ? allZones().map((z) => ({ zone: z, offset: zoneOffset(z) })) : []),
    [open],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal sm:w-96"
          disabled={pending}
        >
          <span className="flex min-w-0 items-center gap-2">
            {pending ? <Spinner className="size-4" /> : <GlobeIcon className="text-muted-foreground" />}
            <span className="truncate">{pretty(value)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{zoneOffset(value)}</span>
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('search')} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t('noMatch')}</CommandEmpty>
            <CommandGroup>
              {zones.map(({ zone, offset }) => (
                <CommandItem
                  key={zone}
                  value={zone}
                  keywords={[pretty(zone), offset]}
                  onSelect={() => {
                    setOpen(false);
                    if (zone !== value) onChange(zone);
                  }}
                >
                  <span className="truncate">{pretty(zone)}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{offset}</span>
                  <CheckIcon className={zone === value ? 'opacity-100' : 'opacity-0'} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
