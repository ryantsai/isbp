'use client';

import type { Condition, ConditionOp, ConditionValue } from '@isbp/sdk';
import { PlusIcon, Trash2Icon } from 'lucide-react';
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
}

type Rule = { fact: string; op: ConditionOp; value?: ConditionValue | ConditionValue[] };
type Group = { mode: 'all' | 'any'; rules: Rule[] };

const NO_VALUE: ConditionOp[] = ['empty', 'notEmpty'];
const LIST_OPS: ConditionOp[] = ['in', 'nin'];

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

/** The builder edits one level: "match all/any of these rules". Nested input is flattened. */
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
        return `${fact?.label ?? c.fact} ${t(`ops.${c.op}`)}${value ? ` ${value}` : ''}`;
      }
      return walk(root);
    },
    [facts, t],
  );
  return render;
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

/**
 * Builds "match all/any of these rules" conditions over a list of facts. Facts can also be typed in
 * freely (any dotted path), so the builder never blocks advanced cases.
 */
export function ConditionBuilder({
  value,
  onChange,
  facts,
  className,
}: {
  value: Condition | null | undefined;
  onChange: (value: Condition | undefined) => void;
  facts: readonly FactOption[];
  className?: string;
}) {
  const t = useTranslations('ui.conditions');
  const uid = useId();
  const group = toGroup(value);
  const emit = (g: Group) => onChange(fromGroup(g));
  const update = (i: number, patch: Partial<Rule>) =>
    emit({ ...group, rules: group.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

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
      {!group.rules.length && <p className="text-sm text-muted-foreground">{t('noRules')}</p>}
      <ul className="grid gap-2">
        <AnimatePresence initial={false}>
          {group.rules.map((rule, i) => {
            const fact = facts.find((f) => f.path === rule.fact);
            const ops = opsFor(fact?.type);
            return (
              <motion.li
                key={`${uid}-${i}`}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border bg-card/60 p-2 @lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
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
                    });
                  }}
                >
                  <SelectTrigger aria-label={t('fact')} className="col-span-2 w-full @lg:col-span-1">
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
                  className="@lg:order-last"
                  aria-label={t('removeRule')}
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
                        {t(`ops.${op}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="col-span-2 min-w-0 @lg:col-span-1">
                  <ValueInput
                    fact={fact}
                    rule={rule}
                    label={t('value')}
                    onChange={(v) => update(i, { value: v })}
                  />
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
          {t('addRule')}
        </Button>
      </div>
    </div>
  );
}
