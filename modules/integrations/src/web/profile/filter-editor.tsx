'use client';

import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
    <div className="grid min-w-0 gap-2">
      {conditions.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}
      {conditions.map((c, i) => {
        const f = F.get(c.field);
        const value = Array.isArray(c.value) ? c.value.join(', ') : (c.value ?? '');
        return (
          <div
            key={i}
            className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]"
          >
            <Select value={c.field || ''} onValueChange={(v) => update(i, { field: v })} disabled={readOnly}>
              <SelectTrigger className="w-full min-w-0" aria-label={t('field', { n: i + 1 })}>
                <SelectValue placeholder={t('chooseField')} />
              </SelectTrigger>
              <SelectContent>
                {fields.map((x) => (
                  <SelectItem key={x.key} value={x.key}>
                    {label(x.label, x.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={c.op} onValueChange={(v) => update(i, { op: v as FilterOp })} disabled={readOnly}>
              <SelectTrigger className="w-full" aria-label={t('operator', { n: i + 1 })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {t(`ops.${op}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {NO_VALUE.includes(c.op) ? (
              <span aria-hidden />
            ) : f?.type === 'choice' && f.choices && c.op !== 'in' ? (
              <Select value={value || ''} onValueChange={(v) => update(i, { value: v })} disabled={readOnly}>
                <SelectTrigger className="w-full min-w-0" aria-label={t('value', { n: i + 1 })}>
                  <SelectValue placeholder={t('chooseValue')} />
                </SelectTrigger>
                <SelectContent>
                  {f.choices.map((ch) => (
                    <SelectItem key={ch.value} value={ch.value}>
                      {label(ch.label, ch.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                aria-label={t('value', { n: i + 1 })}
                value={value}
                disabled={readOnly}
                placeholder={c.op === 'in' ? t('listPlaceholder') : undefined}
                onChange={(e) =>
                  update(i, {
                    value:
                      c.op === 'in'
                        ? e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : e.target.value,
                  })
                }
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-label={t('remove', { n: i + 1 })}
              onClick={() => onChange(conditions.filter((_, k) => k !== i))}
            >
              <Trash2Icon />
            </Button>
          </div>
        );
      })}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => onChange([...conditions, { field: '', op: 'eq', value: '' }])}
        >
          <PlusIcon /> {t('add')}
        </Button>
      )}
    </div>
  );
}
