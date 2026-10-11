'use client';

import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
import { Text } from '@astryxdesign/core/Text';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { VStack } from '@astryxdesign/core/Layout';
import { typePatternSchema } from '@isbp/contracts';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  typesMatching,
  useKnownTypes,
  useModuleName,
  usePatternLabel,
  useTypeLabel,
} from './notification-meta';

type PatternItem = SearchableItem<{ hint?: string }>;

/**
 * Which notifications a channel receives: pick known types (with "all of module" shortcuts) or type a pattern such
 * as `core.access-request.*` and press Enter. Shows how many known types are covered.
 */
export function TypePatternsField({
  value,
  onChange,
  status,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** The form's error for this field (e.g. "Choose at least one notification."). */
  status?: { type: 'error'; message: string };
}) {
  const t = useTranslations('notifications.admin.channels.form.types');
  const tp = useTranslations('notifications.patterns');
  const typeLabel = useTypeLabel();
  const moduleName = useModuleName();
  const patternLabel = usePatternLabel();
  const known = useKnownTypes();
  const [customError, setCustomError] = useState<string | null>(null);

  const knownTypes = known.map((k) => k.type);
  const covered = new Set(value.flatMap((p) => typesMatching(p, knownTypes)));

  // Everything that can be picked: all notifications, then each module (its "all of module" shortcut and its types).
  const source = useMemo(() => {
    const byModule = new Map<string, string[]>();
    for (const k of known) byModule.set(k.moduleId, [...(byModule.get(k.moduleId) ?? []), k.type]);
    const items: PatternItem[] = [{ id: '*', label: tp('all'), auxiliaryData: { hint: '*' } }];
    for (const [moduleId, types] of byModule) {
      items.push({
        id: `${moduleId}.*`,
        label: tp('module', { module: moduleName(moduleId) }),
        auxiliaryData: { hint: `${moduleId}.*` },
      });
      for (const type of types)
        items.push({ id: type, label: typeLabel(type), auxiliaryData: { hint: type } });
    }
    return createStaticSource(items, { keywords: (item) => [item.id] });
  }, [known, tp, typeLabel, moduleName]);

  const selected = useMemo<PatternItem[]>(
    () => value.map((p) => ({ id: p, label: patternLabel(p) ?? p })),
    [value, patternLabel],
  );

  return (
    <VStack gap={1}>
      <Tokenizer<PatternItem>
        label={t('label')}
        description={t('hint')}
        placeholder={t('search')}
        searchSource={source}
        value={selected}
        hasCreate
        hasEntriesOnFocus
        hasClear
        maxMenuItems={500}
        debounceMs={0}
        emptySearchText={t('noMatch')}
        status={customError ? { type: 'error', message: customError } : status}
        renderItem={(item) => (
          <VStack gap={0}>
            <Text maxLines={1}>{item.label}</Text>
            {item.auxiliaryData?.hint && (
              <Text type="code" color="secondary" size="xsm" maxLines={1}>
                {item.auxiliaryData.hint}
              </Text>
            )}
          </VStack>
        )}
        onChange={(items, change) => {
          // A typed pattern has to look like `module.entity.verb` (with `*` wildcards) before it is kept.
          if (change.type === 'create' && !typePatternSchema.safeParse(change.item.id).success) {
            setCustomError(t('patternInvalid'));
            return;
          }
          setCustomError(null);
          onChange(items.map((item) => item.id));
        }}
      />
      {knownTypes.length > 0 && value.length > 0 && (
        <Text type="supporting" color="secondary" aria-live="polite">
          {t('coverage', { covered: covered.size, total: knownTypes.length })}
        </Text>
      )}
    </VStack>
  );
}
