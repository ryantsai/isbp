'use client';

import { localize } from '@isbp/sdk';
import { useApiQuery } from '@isbp/ui/query';
import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import type { CiClass, LookupItem } from '../contracts';

/** Cache prefix every CMDB mutation invalidates. */
export const INVALIDATE = ['/cmdb/'];

export const ciHref = (ci: { reference: string }) => `/cmdb/${ci.reference}`;

const EMPTY_CLASSES: CiClass[] = [];
const EMPTY_ITEMS: LookupItem[] = [];

/** CI classes in display order, with their localized names. */
export function useClasses(enabled = true) {
  const locale = useLocale();
  const query = useApiQuery<{ items: CiClass[] }>(enabled ? '/cmdb/classes' : null);
  const classes = query.data?.items ?? EMPTY_CLASSES;
  const options = useMemo(
    () => classes.map((c) => ({ value: c.key, label: localize(c.name, locale), icon: c.icon })),
    [classes, locale],
  );
  return { classes, options, isLoading: query.isLoading };
}

/** Support groups / departments for pickers and filters (served by the CMDB to its readers). */
export function useLookup(kind: 'groups' | 'departments', enabled = true) {
  const query = useApiQuery<{ items: LookupItem[] }>(enabled ? `/cmdb/lookups/${kind}` : null);
  return { items: query.data?.items ?? EMPTY_ITEMS, isLoading: query.isLoading };
}
