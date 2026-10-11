'use client';

import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead';
import { type Query, useApi } from '@isbp/sdk/web';
import { useEffect, useMemo, useRef } from 'react';

export type { SearchableItem, SearchSource };

interface ApiSearchSourceOptions<Row, Aux> {
  /** The list endpoint, e.g. `/users`. */
  path: string;
  /** Query for what the person typed (`''` for the initial list), e.g. `(q) => ({ q, pageSize: 8 })`. */
  query: (q: string) => Query;
  /** Turns a row into the picker's item: `id` and `label` are what the field shows; keep the full row in `auxiliaryData`. */
  toItem: (row: Row) => SearchableItem<Aux>;
  /** Reads the rows out of the response. Default: the `items` of a `Page<Row>`. */
  rows?: (response: never) => Row[];
  /** Rows to hide (already picked, the record itself…). */
  exclude?: (item: SearchableItem<Aux>) => boolean;
  /** Load the list before anything is typed (shows it when the field is focused). Default: `true`. */
  hasInitialList?: boolean;
}

/**
 * A Typeahead `SearchSource` over an API list endpoint: the one way a picker looks things up. Use it with Astryx
 * `Typeahead` (`<Typeahead label searchSource={source} value={item} onChange={…} />`), which owns debounce, keyboard,
 * loading and empty states. The source is stable between renders; the options may change freely.
 */
export function useApiSearchSource<Row, Aux = Row>(
  options: ApiSearchSourceOptions<Row, Aux>,
): SearchSource<SearchableItem<Aux>> {
  const api = useApi();
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  return useMemo(() => {
    const load = async (q: string) => {
      const { path, query, toItem, rows, exclude } = latest.current;
      const response = await api.get<unknown>(path, query(q));
      const list = rows
        ? rows(response as never)
        : ((response as { items?: Row[] } | undefined)?.items ?? []);
      const items = list.map(toItem);
      return exclude ? items.filter((item) => !exclude(item)) : items;
    };
    return {
      search: (q: string) => load(q),
      bootstrap: () => (latest.current.hasInitialList === false ? [] : load('')),
    };
  }, [api]);
}
