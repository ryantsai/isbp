'use client';

import { type Condition, type ConditionOp, type ConditionValue, TODAY_FACT } from '@isbp/sdk';
import { ArrowLeftRightIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useId } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Input } from './input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

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
  return (
    <Select value={rule.valueFact || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label={t('otherField')} className="w-full">
        <SelectValue placeholder={t('otherField')} />
      </SelectTrigger>
      <SelectContent>
        {others.map((f) => (
          <SelectItem key={f.path} value={f.path}>
            {f.label}
          </SelectItem>
        ))}
        {rule.valueFact && !others.some((f) => f.path === rule.valueFact) && (
          <SelectItem value={rule.valueFact}>{rule.valueFact}</SelectItem>
        )}
      </SelectContent>
    </Select>
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
      <Select value={rule.value === false ? 'false' : 'true'} onValueChange={(v) => onChange(v === 'true')}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t('true')}</SelectItem>
          <SelectItem value="false">{t('false')}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (fact?.options?.length && !LIST_OPS.includes(rule.op)) {
    return (
      <Select value={typeof rule.value === 'string' ? rule.value : undefined} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue placeholder={t('valuePlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {fact.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (LIST_OPS.includes(rule.op)) {
    const text = Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? '');
    return (
      <Input
        aria-label={label}
        placeholder={fact?.options ? fact.options.map((o) => o.value).join(', ') : t('listPlaceholder')}
        defaultValue={text}
        onBlur={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => (fact?.type === 'number' && Number.isFinite(Number(s)) ? Number(s) : s)),
          )
        }
      />
    );
  }
  return (
    <Input
      aria-label={label}
      type={fact?.type === 'number' ? 'number' : fact?.type === 'date' ? 'date' : 'text'}
      placeholder={t('valuePlaceholder')}
      value={rule.value === undefined || rule.value === null ? '' : String(rule.value)}
      onChange={(e) =>
        onChange(fact?.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)
      }
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
    <div className="flex shrink-0 items-center gap-1">
      <Input
        type="number"
        inputMode="numeric"
        step={1}
        min={-36_500}
        max={36_500}
        aria-label={t('offsetDays')}
        title={t('offsetDays')}
        placeholder="±0"
        className="w-20"
        value={value ?? ''}
        onChange={(e) => {
          const n = e.target.value === '' ? undefined : Math.trunc(Number(e.target.value));
          onChange(
            n === undefined || !Number.isFinite(n) || n === 0
              ? undefined
              : Math.max(-36_500, Math.min(36_500, n)),
          );
        }}
      />
      <span aria-hidden className="text-xs text-muted-foreground">
        {t('days')}
      </span>
    </div>
  );
}

/** The value "Today" (`valueFact: 'today'`) in place of a date, with a button back to a fixed date. */
function TodayValue({ label, onClear }: { label: string; onClear: () => void }) {
  const t = useTranslations('ui.conditions');
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-muted/40 pr-1 pl-3 text-sm shadow-xs"
    >
      <span className="truncate">{t('today')}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t('pickDate')}
        title={t('pickDate')}
        onClick={onClear}
      >
        <XIcon />
      </Button>
    </div>
  );
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
  const emit = (g: Group) => onChange(fromGroup(g));
  const update = (i: number, patch: Partial<Rule>) =>
    emit({
      ...group,
      rules: group.rules.map((r, j) => {
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
        <div className="flex items-center gap-2 text-sm">
          <span>{t('match')}</span>
          <Select value={group.mode} onValueChange={(m) => emit({ ...group, mode: m as Group['mode'] })}>
            <SelectTrigger size="sm" aria-label={t('match')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all')}</SelectItem>
              <SelectItem value="any">{t('any')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {!group.rules.length && (
        <p className="text-sm text-muted-foreground">{emptyText ?? t('noConditions')}</p>
      )}
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
            return (
              <motion.li
                key={`${uid}-${i}`}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border bg-card/60 p-2 @2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
              >
                <Select
                  value={rule.fact || undefined}
                  onValueChange={(path) => {
                    const next = facts.find((f) => f.path === path);
                    const nextOps = opsFor(next?.type);
                    update(i, {
                      fact: path,
                      op: nextOps.includes(rule.op) ? rule.op : nextOps[0]!,
                      value: next?.type === 'boolean' ? true : undefined,
                      valueFact: rule.valueFact === path ? undefined : rule.valueFact,
                    });
                  }}
                >
                  <SelectTrigger aria-label={t('fact')} className="col-span-2 w-full @2xl:col-span-1">
                    <SelectValue placeholder={t('fact')} />
                  </SelectTrigger>
                  <SelectContent>
                    {facts.map((f) => (
                      <SelectItem key={f.path} value={f.path}>
                        {f.label}
                      </SelectItem>
                    ))}
                    {rule.fact && !fact && <SelectItem value={rule.fact}>{rule.fact}</SelectItem>}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="@2xl:order-last"
                  aria-label={t('removeCondition', { n: i + 1 })}
                  onClick={() => emit({ ...group, rules: group.rules.filter((_, j) => j !== i) })}
                >
                  <Trash2Icon />
                </Button>
                <Select value={rule.op} onValueChange={(op) => update(i, { op: op as ConditionOp })}>
                  <SelectTrigger aria-label={t('op')} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(ops.includes(rule.op) ? ops : [rule.op, ...ops]).map((op) => (
                      <SelectItem key={op} value={op}>
                        {t(opKey(op, fact?.type))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* The value, then its extras (days to add, compare with a field); the extras wrap when narrow. */}
                <div className="col-span-2 flex min-w-0 flex-wrap items-start gap-1 @2xl:col-span-1">
                  <div className="flex min-w-36 flex-1 items-start gap-1">
                    <div className="min-w-0 flex-1">
                      {isToday && todayButton ? (
                        <TodayValue label={t('value')} onClear={() => update(i, { valueFact: undefined })} />
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
                        type="button"
                        variant="outline"
                        className="shrink-0 px-2.5"
                        aria-label={t('useToday')}
                        title={t('useToday')}
                        onClick={() => update(i, { valueFact: TODAY_FACT })}
                      >
                        {t('today')}
                      </Button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-start gap-1 empty:hidden">
                    {fact?.type === 'date' && compares && (
                      <OffsetInput
                        value={rule.valueOffsetDays}
                        onChange={(valueOffsetDays) => update(i, { valueOffsetDays })}
                      />
                    )}
                    {compares && otherFacts.some((f) => f.path !== rule.fact) && fact?.type !== 'boolean' && (
                      <Button
                        type="button"
                        variant={comparesField ? 'secondary' : 'ghost'}
                        size="icon"
                        aria-pressed={comparesField}
                        aria-label={t('compareWithField')}
                        title={t('compareWithField')}
                        onClick={() =>
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
                      >
                        <ArrowLeftRightIcon />
                      </Button>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            emit({
              ...group,
              rules: [
                ...group.rules,
                {
                  fact: facts[0]?.path ?? '',
                  op: opsFor(facts[0]?.type)[0]!,
                  value: facts[0]?.type === 'boolean' ? true : undefined,
                },
              ],
            })
          }
        >
          <PlusIcon />
          {t('addCondition')}
        </Button>
      </div>
    </div>
  );
}
