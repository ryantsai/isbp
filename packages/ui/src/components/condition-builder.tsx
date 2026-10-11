'use client';

import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { Token } from '@astryxdesign/core/Token';
import { type Condition, type ConditionOp, type ConditionValue, TODAY_FACT } from '@isbp/sdk';
import { ArrowLeftRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState } from 'react';
import { useLatest } from '../lib/use-latest';
import { cn } from '../lib/utils';

/** A field a condition can test: workflow facts (`role.riskLevel`) or other form fields. */
export interface FactOption {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'id' | 'list';
  options?: { value: string; label: string }[];
  /** The fact names people (user ids) or groups (group keys) — approver rules pick from these. */
  ref?: 'user' | 'group';
}

type Rule = {
  fact: string;
  op: ConditionOp;
  value?: ConditionValue | ConditionValue[];
  valueFact?: string;
  valueOffsetDays?: number;
};
type Group = { mode: 'all' | 'any'; rules: Rule[] };

const NO_VALUE: ConditionOp[] = ['empty', 'notEmpty'];
const LIST_OPS: ConditionOp[] = ['in', 'nin'];
/** Operators that can compare a fact with another fact (`valueFact`). */
const COMPARE_OPS: ConditionOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
/** Operators with their own wording for dates ("is after", "is on or before"). */
const DATE_OPS: ConditionOp[] = ['gt', 'gte', 'lt', 'lte'];

/** The translation key of an operator for a fact of this type. */
const opKey = (op: ConditionOp, type: FactOption['type'] | undefined) =>
  type === 'date' && DATE_OPS.includes(op) ? `dateOps.${op}` : `ops.${op}`;

function opsFor(type: FactOption['type'] | undefined): ConditionOp[] {
  switch (type) {
    case 'number':
    case 'date':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'];
    case 'boolean':
      return ['eq', 'neq'];
    case 'list':
      return ['contains', 'empty', 'notEmpty'];
    default:
      return ['eq', 'neq', 'in', 'nin', 'contains', 'empty', 'notEmpty'];
  }
}

/** The builder edits one level: "match all/any of these conditions". Nested input is flattened. */
export function toGroup(condition: Condition | null | undefined): Group {
  if (!condition) return { mode: 'all', rules: [] };
  if ('all' in condition || 'any' in condition) {
    const list = 'all' in condition ? condition.all : condition.any;
    return {
      mode: 'all' in condition ? 'all' : 'any',
      rules: list.filter((c): c is Rule => 'fact' in c),
    };
  }
  if ('fact' in condition) return { mode: 'all', rules: [condition] };
  return { mode: 'all', rules: [] };
}

export function fromGroup(g: Group): Condition | undefined {
  if (!g.rules.length) return undefined;
  if (g.rules.length === 1) return g.rules[0];
  return g.mode === 'all' ? { all: g.rules } : { any: g.rules };
}

/** Human-readable summary, e.g. "Risk level is High and Duration is more than 14". */
export function useConditionText(facts: readonly FactOption[]) {
  const t = useTranslations('ui.conditions');
  const render = useCallback(
    (root: Condition | null | undefined): string => {
      function walk(c: Condition | null | undefined): string {
        if (!c) return t('always');
        if ('all' in c || 'any' in c) {
          const list = 'all' in c ? c.all : c.any;
          if (!list.length) return t('always');
          return list.map(walk).join(` ${t('all' in c ? 'and' : 'or')} `);
        }
        if ('not' in c) return t('not', { condition: walk(c.not) });
        const fact = facts.find((f) => f.path === c.fact);
        const op = t(opKey(c.op, fact?.type));
        const days = c.valueOffsetDays;
        const offset = days ? ` ${t('offsetText', { offset: `${days > 0 ? '+' : ''}${days}` })}` : '';
        if (c.valueFact) {
          const other =
            facts.find((f) => f.path === c.valueFact)?.label ??
            (c.valueFact === TODAY_FACT ? t('today') : c.valueFact);
          return `${fact?.label ?? c.fact} ${op} ${other}${offset}`;
        }
        const valueText = (v: ConditionValue | undefined) => {
          if (v === true) return t('true');
          if (v === false) return t('false');
          const opt = fact?.options?.find((o) => o.value === String(v));
          return opt?.label ?? String(v ?? '');
        };
        const value = NO_VALUE.includes(c.op)
          ? ''
          : Array.isArray(c.value)
            ? c.value.map(valueText).join(', ')
            : valueText(c.value);
        return `${fact?.label ?? c.fact} ${op}${value ? ` ${value}` : ''}${offset}`;
      }
      return walk(root);
    },
    [facts, t],
  );
  return render;
}

/** Another fact to compare with (`valueFact`), of a compatible type. */
function OtherFactSelect({
  fact,
  rule,
  facts,
  onChange,
}: {
  fact: FactOption | undefined;
  rule: Rule;
  /** The facts it may be compared with (today is left out when it has its own button). */
  facts: readonly FactOption[];
  onChange: (path: string) => void;
}) {
  const t = useTranslations('ui.conditions');
  const others = facts.filter(
    (f) =>
      f.path !== rule.fact &&
      (!fact || f.type === fact.type || f.type === 'string' || fact.type === 'string'),
  );
  const options = others.map((f) => ({ value: f.path, label: f.label }));
  if (rule.valueFact && !others.some((f) => f.path === rule.valueFact))
    options.push({ value: rule.valueFact, label: rule.valueFact });
  return (
    <Selector
      label={t('otherField')}
      isLabelHidden
      width="100%"
      placeholder={t('otherField')}
      hasSearch={options.length > 10}
      options={options}
      value={rule.valueFact || undefined}
      onChange={onChange}
    />
  );
}

/** "A, B, C" in one box: the list is read when the field is left. */
function ListValueInput({
  fact,
  rule,
  label,
  onChange,
}: {
  fact: FactOption | undefined;
  rule: Rule;
  label: string;
  onChange: (v: Rule['value']) => void;
}) {
  const t = useTranslations('ui.conditions');
  const [text, setText] = useState(
    Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? ''),
  );
  return (
    <TextInput
      label={label}
      isLabelHidden
      placeholder={fact?.options ? fact.options.map((o) => o.value).join(', ') : t('listPlaceholder')}
      value={text}
      onChange={setText}
      onBlur={() =>
        onChange(
          text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => (fact?.type === 'number' && Number.isFinite(Number(s)) ? Number(s) : s)),
        )
      }
    />
  );
}

function ValueInput({
  fact,
  rule,
  onChange,
  label,
}: {
  fact: FactOption | undefined;
  rule: Rule;
  onChange: (v: Rule['value']) => void;
  label: string;
}) {
  const t = useTranslations('ui.conditions');
  if (NO_VALUE.includes(rule.op)) return null;
  if (fact?.type === 'boolean') {
    return (
      <Selector
        label={label}
        isLabelHidden
        width="100%"
        options={[
          { value: 'true', label: t('true') },
          { value: 'false', label: t('false') },
        ]}
        value={rule.value === false ? 'false' : 'true'}
        onChange={(v) => onChange(v === 'true')}
      />
    );
  }
  if (fact?.options?.length && !LIST_OPS.includes(rule.op)) {
    return (
      <Selector
        label={label}
        isLabelHidden
        width="100%"
        placeholder={t('valuePlaceholder')}
        hasSearch={fact.options.length > 10}
        options={fact.options}
        value={typeof rule.value === 'string' ? rule.value : undefined}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (LIST_OPS.includes(rule.op)) {
    return <ListValueInput fact={fact} rule={rule} label={label} onChange={onChange} />;
  }
  if (fact?.type === 'number') {
    const n =
      rule.value === undefined || rule.value === null || rule.value === '' ? null : Number(rule.value);
    return (
      <NumberInput
        label={label}
        isLabelHidden
        placeholder={t('valuePlaceholder')}
        value={n !== null && Number.isFinite(n) ? n : null}
        hasClear
        onChange={(v) => onChange(v ?? undefined)}
      />
    );
  }
  if (fact?.type === 'date') {
    return (
      <DateInput
        label={label}
        isLabelHidden
        placeholder={t('valuePlaceholder')}
        hasClear
        value={
          (typeof rule.value === 'string' && rule.value ? rule.value : undefined) as ISODateString | undefined
        }
        onChange={(v) => onChange(v ?? undefined)}
      />
    );
  }
  return (
    <TextInput
      label={label}
      isLabelHidden
      placeholder={t('valuePlaceholder')}
      value={rule.value === undefined || rule.value === null ? '' : String(rule.value)}
      onChange={(v) => onChange(v)}
    />
  );
}

/** "± days" on a date comparison (`valueOffsetDays`): the compared date plus (or minus) this many days. */
function OffsetInput({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (days: number | undefined) => void;
}) {
  const t = useTranslations('ui.conditions');
  return (
    <NumberInput
      label={t('offsetDays')}
      isLabelHidden
      width={144}
      isIntegerOnly
      min={-36_500}
      max={36_500}
      placeholder="±0"
      units={t('days')}
      hasClear
      value={value ?? null}
      onChange={(n) => onChange(n === null || n === 0 ? undefined : n)}
    />
  );
}

/** The value "Today" (`valueFact: 'today'`) in place of a date, with a button back to a fixed date. */
function TodayValue({ onClear }: { onClear: () => void }) {
  const t = useTranslations('ui.conditions');
  return <Token label={t('today')} onRemove={onClear} />;
}

/**
 * Builds "match all/any of these conditions" over a list of facts. Facts can also be typed in freely (any dotted
 * path), so the builder never blocks advanced cases. Date facts compare with a date, with **Today** (when `facts`
 * includes the reserved `today` fact) or with another field.
 */
export function ConditionBuilder({
  value,
  onChange,
  facts,
  emptyText,
  className,
}: {
  value: Condition | null | undefined;
  onChange: (value: Condition | undefined) => void;
  facts: readonly FactOption[];
  /** What having no conditions means here ("No conditions: runs for every request."). */
  emptyText?: string;
  className?: string;
}) {
  const t = useTranslations('ui.conditions');
  const uid = useId();
  const group = toGroup(value);
  const todayOffered = facts.some((f) => f.path === TODAY_FACT);
  // The newest group: a value input commits when it is left, which can land after another change and before the next
  // render (see `useLatest`).
  const latest = useLatest(group);
  const emit = (g: Group) => {
    latest.set(g);
    onChange(fromGroup(g));
  };
  const update = (i: number, patch: Partial<Rule>) =>
    emit({
      ...latest.get(),
      rules: latest.get().rules.map((r, j) => {
        if (j !== i) return r;
        const next: Rule = { ...r, ...patch };
        // A comparison with another fact has no fixed value (and only some operators compare).
        if (next.valueFact && !COMPARE_OPS.includes(next.op)) delete next.valueFact;
        if (next.valueFact) delete next.value;
        if (!next.valueFact) delete next.valueFact;
        // Days are added to dates in comparisons only.
        const nextFact = facts.find((f) => f.path === next.fact);
        if (!next.valueOffsetDays || !COMPARE_OPS.includes(next.op) || nextFact?.type !== 'date')
          delete next.valueOffsetDays;
        return next;
      }),
    });

  return (
    // Lays out by its own width (container query), so it also fits narrow side panels.
    <div className={cn('@container grid gap-3', className)}>
      {group.rules.length > 1 && (
        <HStack gap={2} vAlign="center">
          <Text>{t('match')}</Text>
          <Selector
            label={t('match')}
            isLabelHidden
            size="sm"
            options={[
              { value: 'all', label: t('all') },
              { value: 'any', label: t('any') },
            ]}
            value={group.mode}
            onChange={(m) => emit({ ...latest.get(), mode: m as Group['mode'] })}
          />
        </HStack>
      )}
      {!group.rules.length && <Text color="secondary">{emptyText ?? t('noConditions')}</Text>}
      <ul className="grid gap-2">
        <AnimatePresence initial={false}>
          {group.rules.map((rule, i) => {
            const fact = facts.find((f) => f.path === rule.fact);
            const ops = opsFor(fact?.type);
            const compares = COMPARE_OPS.includes(rule.op);
            // A date compared with today: its own button and value box rather than "another field".
            const todayButton = todayOffered && fact?.type === 'date' && compares && rule.fact !== TODAY_FACT;
            const isToday = rule.valueFact === TODAY_FACT;
            const otherFacts = todayButton ? facts.filter((f) => f.path !== TODAY_FACT) : facts;
            const comparesField = Boolean(rule.valueFact) && !isToday;
            const factOptions = facts.map((f) => ({ value: f.path, label: f.label }));
            if (rule.fact && !fact) factOptions.push({ value: rule.fact, label: rule.fact });
            return (
              <motion.li
                key={`${uid}-${i}`}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Card variant="muted" padding={2}>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 @2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                    <div className="col-span-2 min-w-0 @2xl:col-span-1">
                      <Selector
                        label={t('fact')}
                        isLabelHidden
                        width="100%"
                        placeholder={t('fact')}
                        hasSearch={factOptions.length > 10}
                        options={factOptions}
                        value={rule.fact || undefined}
                        onChange={(path) => {
                          const next = facts.find((f) => f.path === path);
                          const nextOps = opsFor(next?.type);
                          update(i, {
                            fact: path,
                            op: nextOps.includes(rule.op) ? rule.op : nextOps[0]!,
                            value: next?.type === 'boolean' ? true : undefined,
                            valueFact: rule.valueFact === path ? undefined : rule.valueFact,
                          });
                        }}
                      />
                    </div>
                    <div className="@2xl:order-last">
                      <IconButton
                        label={t('removeCondition', { n: i + 1 })}
                        variant="ghost"
                        icon={<Icon icon={Trash2Icon} />}
                        type="button"
                        onClick={() =>
                          emit({ ...latest.get(), rules: latest.get().rules.filter((_, j) => j !== i) })
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <Selector
                        label={t('op')}
                        isLabelHidden
                        width="100%"
                        options={(ops.includes(rule.op) ? ops : [rule.op, ...ops]).map((op) => ({
                          value: op,
                          label: t(opKey(op, fact?.type)),
                        }))}
                        value={rule.op}
                        onChange={(op) => update(i, { op: op as ConditionOp })}
                      />
                    </div>
                    {/* The value, then its extras (days to add, compare with a field); the extras wrap when narrow. */}
                    <div className="col-span-2 flex min-w-0 flex-wrap items-start gap-1 @2xl:col-span-1">
                      <div className="flex min-w-36 flex-1 items-start gap-1">
                        <div className="min-w-0 flex-1">
                          {isToday && todayButton ? (
                            <TodayValue onClear={() => update(i, { valueFact: undefined })} />
                          ) : rule.valueFact ? (
                            <OtherFactSelect
                              fact={fact}
                              rule={rule}
                              facts={otherFacts}
                              onChange={(path) => update(i, { valueFact: path })}
                            />
                          ) : (
                            <ValueInput
                              fact={fact}
                              rule={rule}
                              label={t('value')}
                              onChange={(v) => update(i, { value: v })}
                            />
                          )}
                        </div>
                        {todayButton && !rule.valueFact && (
                          <Button
                            label={t('today')}
                            variant="secondary"
                            tooltip={t('useToday')}
                            type="button"
                            onClick={() => update(i, { valueFact: TODAY_FACT })}
                          />
                        )}
                      </div>
                      <div className="flex shrink-0 items-start gap-1 empty:hidden">
                        {fact?.type === 'date' && compares && (
                          <OffsetInput
                            value={rule.valueOffsetDays}
                            onChange={(valueOffsetDays) => update(i, { valueOffsetDays })}
                          />
                        )}
                        {compares &&
                          otherFacts.some((f) => f.path !== rule.fact) &&
                          fact?.type !== 'boolean' && (
                            <ToggleButton
                              label={t('compareWithField')}
                              tooltip={t('compareWithField')}
                              isIconOnly
                              icon={<Icon icon={ArrowLeftRightIcon} />}
                              isPressed={comparesField}
                              onPressedChange={() =>
                                update(
                                  i,
                                  comparesField
                                    ? { valueFact: undefined }
                                    : {
                                        valueFact:
                                          otherFacts.find(
                                            (f) => f.path !== rule.fact && (!fact || f.type === fact.type),
                                          )?.path ?? otherFacts.find((f) => f.path !== rule.fact)?.path,
                                      },
                                )
                              }
                            />
                          )}
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div>
        <Button
          label={t('addCondition')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          type="button"
          onClick={() =>
            emit({
              ...latest.get(),
              rules: [
                ...latest.get().rules,
                {
                  fact: facts[0]?.path ?? '',
                  op: opsFor(facts[0]?.type)[0]!,
                  value: facts[0]?.type === 'boolean' ? true : undefined,
                },
              ],
            })
          }
        />
      </div>
    </div>
  );
}
