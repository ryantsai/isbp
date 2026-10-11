'use client';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FILTER_OPS, type FilterCondition, type FilterOp, type LocalField } from '../../contracts';
import { useLabel } from '../lib';

const NO_VALUE: readonly FilterOp[] = ['empty', 'not_empty'];

/** Which local records may be created remotely: simple field conditions, all of which must hold. */
export function FilterEditor({
  conditions,
  onChange,
  fields,
  readOnly,
}: {
  conditions: FilterCondition[];
  onChange: (c: FilterCondition[]) => void;
  fields: LocalField[];
  readOnly: boolean;
}) {
  const t = useTranslations('integrations.filter');
  const label = useLabel();
  const F = new Map(fields.map((f) => [f.key, f]));
  const update = (i: number, patch: Partial<FilterCondition>) =>
    onChange(conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <VStack gap={2} className="min-w-0">
      {conditions.length === 0 && <Text color="secondary">{t('none')}</Text>}
      {conditions.map((c, i) => {
        const f = F.get(c.field);
        const value = Array.isArray(c.value) ? c.value.join(', ') : (c.value ?? '');
        return (
          <HStack key={i} gap={2} wrap="wrap" vAlign="center">
            <div className="min-w-0 flex-1 basis-44">
              <Selector
                label={t('field', { n: i + 1 })}
                isLabelHidden
                placeholder={t('chooseField')}
                isDisabled={readOnly}
                options={fields.map((x) => ({ value: x.key, label: label(x.label, x.key) }))}
                value={c.field}
                onChange={(v) => update(i, { field: v })}
              />
            </div>
            <div className="min-w-0 flex-1 basis-36">
              <Selector
                label={t('operator', { n: i + 1 })}
                isLabelHidden
                isDisabled={readOnly}
                options={FILTER_OPS.map((op) => ({ value: op, label: t(`ops.${op}`) }))}
                value={c.op}
                onChange={(v) => update(i, { op: v as FilterOp })}
              />
            </div>
            {NO_VALUE.includes(c.op) ? null : (
              <div className="min-w-0 flex-1 basis-44">
                {f?.type === 'choice' && f.choices && c.op !== 'in' ? (
                  <Selector
                    label={t('value', { n: i + 1 })}
                    isLabelHidden
                    placeholder={t('chooseValue')}
                    isDisabled={readOnly}
                    options={f.choices.map((ch) => ({ value: ch.value, label: label(ch.label, ch.value) }))}
                    value={value}
                    onChange={(v) => update(i, { value: v })}
                  />
                ) : (
                  <TextInput
                    label={t('value', { n: i + 1 })}
                    isLabelHidden
                    value={value}
                    isDisabled={readOnly}
                    placeholder={c.op === 'in' ? t('listPlaceholder') : undefined}
                    onChange={(v) =>
                      update(i, {
                        value:
                          c.op === 'in'
                            ? v
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean)
                            : v,
                      })
                    }
                  />
                )}
              </div>
            )}
            <IconButton
              label={t('remove', { n: i + 1 })}
              variant="ghost"
              size="sm"
              icon={<Icon icon={Trash2Icon} />}
              isDisabled={readOnly}
              type="button"
              onClick={() => onChange(conditions.filter((_, k) => k !== i))}
            />
          </HStack>
        );
      })}
      {!readOnly && (
        <div>
          <Button
            label={t('add')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            type="button"
            onClick={() => onChange([...conditions, { field: '', op: 'eq', value: '' }])}
          />
        </div>
      )}
    </VStack>
  );
}
