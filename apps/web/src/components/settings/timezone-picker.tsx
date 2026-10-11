'use client';

import { Selector } from '@astryxdesign/core/Selector';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

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
const optionOf = (zone: string) => {
  const offset = zoneOffset(zone);
  return { value: zone, label: offset ? `${pretty(zone)} (${offset})` : pretty(zone) };
};

/** Searchable IANA time-zone picker (Astryx `Selector` with search). */
export function TimezonePicker({
  label,
  description,
  value,
  onChange,
  pending,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (zone: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations('settings.preferences.timezone');
  // Offsets are computed for the ≈400 zones right after the first paint, not during it: until then the list
  // holds just the current zone.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(handle);
  }, []);
  const options = useMemo(() => (ready ? allZones().map(optionOf) : [optionOf(value)]), [ready, value]);
  // The profile's zone may be missing from the runtime's list (an alias): keep it selectable.
  const withValue = options.some((o) => o.value === value) ? options : [optionOf(value), ...options];

  return (
    <Selector
      label={label}
      description={description}
      options={withValue}
      value={value}
      hasSearch
      searchPlaceholder={t('search')}
      emptySearchText={t('noMatch')}
      isDisabled={pending}
      isLoading={pending}
      width="min(100%, 24rem)"
      onChange={(zone) => {
        if (zone && zone !== value) onChange(zone);
      }}
    />
  );
}
