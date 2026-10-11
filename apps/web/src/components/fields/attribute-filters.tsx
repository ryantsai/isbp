'use client';

import { localize } from '@isbp/sdk';
import { SlidersHorizontalIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type EntityType, useEntityFields } from './entity-fields';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Popover } from '@astryxdesign/core/Popover';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';

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
    <Popover
      label={t('title')}
      width={288}
      content={
        <VStack gap={4}>
          <Text weight="medium">{t('title')}</Text>
          {filterable.map((f) => (
            <Selector
              key={f.key}
              label={localize(f.label, locale) || f.key}
              value={current[f.key] ?? ANY}
              onChange={(v) => set(f.key, v === ANY ? null : v)}
              options={[
                { value: ANY, label: t('any') },
                ...f.options!.map((o) => ({ value: o.value, label: localize(o.label, locale) || o.value })),
              ]}
            />
          ))}
          {count > 0 && <Button label={t('clear')} variant="ghost" size="sm" onClick={() => onChange([])} />}
        </VStack>
      }
    >
      <Button
        label={t('more')}
        variant="secondary"
        icon={<Icon icon={SlidersHorizontalIcon} />}
        endContent={count > 0 ? <Badge label={t('active', { count })} variant="info" /> : undefined}
      />
    </Popover>
  );
}
