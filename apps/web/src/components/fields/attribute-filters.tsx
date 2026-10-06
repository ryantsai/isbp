'use client';

import { localize } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Label } from '@isbp/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { SlidersHorizontalIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { type EntityType, useEntityFields } from './entity-fields';

const ANY = '__any__';

/** `["office:tokyo", …]` ⇄ `{ office: "tokyo" }` (the API's repeatable `attr=key:value`). */
export function parseAttrFilters(pairs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const at = p.indexOf(':');
    if (at > 0) out[p.slice(0, at)] = p.slice(at + 1);
  }
  return out;
}

/**
 * "More filters" for an entity list: one choice per dropdown-type custom field. Renders nothing when
 * the entity has no such fields.
 */
export function AttributeFilters({
  entityType,
  value,
  onChange,
}: {
  entityType: EntityType;
  value: readonly string[];
  onChange: (pairs: string[]) => void;
}) {
  const t = useTranslations('fields.filters');
  const locale = useLocale();
  const uid = useId();
  const { fields } = useEntityFields(entityType);
  const filterable = fields.filter((f) => f.type === 'select' && f.options?.length);
  if (!filterable.length) return null;
  const current = parseAttrFilters(value);
  const known = new Set(filterable.map((f) => f.key));
  const count = Object.keys(current).filter((k) => known.has(k)).length;
  const set = (key: string, v: string | null) => {
    const next = { ...current };
    if (v === null) delete next[key];
    else next[key] = v;
    onChange(Object.entries(next).map(([k, x]) => `${k}:${x}`));
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <SlidersHorizontalIcon aria-hidden />
          {t('more')}
          {count > 0 && (
            <Badge variant="default" className="px-1.5 tabular-nums">
              <span aria-hidden>{count}</span>
              <span className="sr-only">{t('active', { count })}</span>
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="grid gap-4">
          <p className="text-sm font-medium">{t('title')}</p>
          {filterable.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={`${uid}-${f.key}`}>{localize(f.label, locale) || f.key}</Label>
              <Select value={current[f.key] ?? ANY} onValueChange={(v) => set(f.key, v === ANY ? null : v)}>
                <SelectTrigger id={`${uid}-${f.key}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('any')}</SelectItem>
                  {f.options!.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {localize(o.label, locale) || o.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {count > 0 && (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => onChange([])}>
              {t('clear')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
