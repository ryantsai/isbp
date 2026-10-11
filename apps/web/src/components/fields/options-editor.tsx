'use client';

import type { FieldOption } from '@isbp/sdk';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { ArrowDownIcon, ArrowUpIcon, LockIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef } from 'react';
import { hasText, isAutoValue, slugValue, uniqueName } from './field-utils';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { TextInput } from '@astryxdesign/core/TextInput';

/**
 * Choices of a dropdown / multiple-choice field: a localized label and a stored value each. Values
 * follow the English label until edited by hand; values already used by a published version are locked.
 */
export function OptionsEditor({
  value,
  onChange,
  lockedValues,
  invalid,
  describedBy,
}: {
  value: FieldOption[];
  onChange: (options: FieldOption[]) => void;
  lockedValues?: ReadonlySet<string>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('fields.editor');
  const locale = useLocale();
  const uid = useId();
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current === null) return;
    document.getElementById(`${uid}-label-${focusIndex.current}`)?.focus();
    focusIndex.current = null;
  }, [value.length, uid]);

  const values = (except: number) => new Set(value.filter((_, j) => j !== except).map((o) => o.value));
  const update = (i: number, next: FieldOption) => onChange(value.map((o, j) => (j === i ? next : o)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    // Keep the keyboard on the moved option.
    requestAnimationFrame(() => {
      const atEdge = j === 0 || j === value.length - 1;
      const dir = atEdge ? (by < 0 ? 'down' : 'up') : by < 0 ? 'up' : 'down';
      document.getElementById(`${uid}-${dir}-${j}`)?.focus();
    });
  };
  const add = () => {
    const n = value.length + 1;
    const taken = new Set(value.map((o) => o.value));
    focusIndex.current = value.length;
    onChange([
      ...value,
      { value: uniqueName(`option${n}`, taken), label: { [locale]: t('optionN', { n }) } },
    ]);
  };

  return (
    <div className="grid gap-2" aria-describedby={describedBy}>
      <ol className="grid gap-2">
        <AnimatePresence initial={false}>
          {value.map((o, i) => {
            const locked = Boolean(lockedValues?.has(o.value));
            const name = o.label.en || Object.values(o.label).find(Boolean) || o.value;
            return (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.16 }}
                className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-1.5 rounded-lg border bg-card p-2"
              >
                <span
                  aria-hidden
                  className="mt-2 grid size-5 place-items-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground tabular-nums"
                >
                  {i + 1}
                </span>
                <LocalizedInput
                  id={`${uid}-label-${i}`}
                  aria-label={t('optionLabelN', { n: i + 1 })}
                  value={o.label}
                  invalid={invalid && !hasText(o.label)}
                  onChange={(label) => {
                    const auto = !locked && isAutoValue(o.value, o.label);
                    const slug = slugValue(label.en);
                    update(i, {
                      label,
                      value: auto && slug ? uniqueName(slug, values(i), '-') : o.value,
                    });
                  }}
                />
                <div className="flex items-start gap-0.5">
                  <IconButton
                    label={t('moveOptionUp', { label: name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={ArrowUpIcon} />}
                    isDisabled={i === 0}
                    type="button"
                    id={`${uid}-up-${i}`}
                    onClick={() => move(i, -1)}
                  />
                  <IconButton
                    label={t('moveOptionDown', { label: name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={ArrowDownIcon} />}
                    isDisabled={i === value.length - 1}
                    type="button"
                    id={`${uid}-down-${i}`}
                    onClick={() => move(i, 1)}
                  />
                  <IconButton
                    label={t('removeOption', { label: name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={Trash2Icon} />}
                    type="button"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                  />
                </div>
                <div className="col-start-2">
                  <TextInput
                    label={t('optionValue')}
                    size="sm"
                    id={`${uid}-value-${i}`}
                    value={o.value}
                    isReadOnly={locked}
                    startIcon={locked ? LockIcon : undefined}
                    description={locked ? t('optionValueLocked') : undefined}
                    status={invalid && !o.value.trim() ? { type: 'error' } : undefined}
                    onChange={(v) => update(i, { ...o, value: v.replace(/\s+/g, '-') })}
                  />
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
      <div>
        <Button
          label={t('addOption')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          type="button"
          onClick={add}
        />
      </div>
    </div>
  );
}
