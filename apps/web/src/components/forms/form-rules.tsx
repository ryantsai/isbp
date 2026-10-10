'use client';

import {
  type Condition,
  conditionFacts,
  type FieldDef,
  type FormRule,
  type LocalizedText,
  localize,
  RESERVED_FACTS,
} from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { ConditionBuilder, useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  fieldFacts,
  hasText,
  incompleteConditions,
  newElementId,
  useTodayFact,
} from '@/components/fields/field-utils';

export type RuleIssueCode = 'requireEmpty' | 'conditionIncomplete' | 'messageEmpty' | 'unknownField';

/** Problems that stop a rule from saving (the API runs the same schema), as codes the editor translates. */
export function ruleIssues(rule: Partial<FormRule>, fields: readonly FieldDef[]): RuleIssueCode[] {
  const keys = new Set(fields.map((f) => f.key));
  const issues: RuleIssueCode[] = [];
  if (!rule.require || !conditionFacts(rule.require).length) issues.push('requireEmpty');
  // A condition without its value never holds as intended ("End is after …").
  if (incompleteConditions(rule.when) + incompleteConditions(rule.require) > 0)
    issues.push('conditionIncomplete');
  if (!hasText(rule.message)) issues.push('messageEmpty');
  const used = [...conditionFacts(rule.when), ...conditionFacts(rule.require), ...(rule.fields ?? [])].filter(
    (k) => !RESERVED_FACTS.includes(k),
  );
  if (used.some((k) => !keys.has(k.split('.')[0] ?? ''))) issues.push('unknownField');
  return issues;
}

/** Issues of every rule, by rule id. */
export function rulesIssues(
  rules: readonly FormRule[],
  fields: readonly FieldDef[],
): Map<string, RuleIssueCode[]> {
  const out = new Map<string, RuleIssueCode[]>();
  for (const r of rules) {
    const list = ruleIssues(r, fields);
    if (list.length) out.set(r.id, list);
  }
  return out;
}

type Draft = { id: string; when?: Condition; require?: Condition; message: LocalizedText; fields: string[] };

function RuleSheet({
  draft,
  isNew,
  fields,
  onSave,
  onClose,
}: {
  draft: Draft;
  isNew: boolean;
  fields: readonly FieldDef[];
  onSave: (rule: FormRule) => void;
  onClose: () => void;
}) {
  const t = useTranslations('forms.rules');
  const locale = useLocale();
  const uid = useId();
  const [value, setValue] = useState<Draft>(draft);
  const [tried, setTried] = useState(false);
  const today = useTodayFact();
  const facts = useMemo(() => [...fieldFacts(fields, locale), today], [fields, locale, today]);
  const issues = ruleIssues(value, fields);
  const save = () => {
    setTried(true);
    if (issues.length) return;
    const rule: FormRule = { id: value.id, require: value.require!, message: value.message };
    if (value.when) rule.when = value.when;
    if (value.fields.length) rule.fields = value.fields;
    onSave(rule);
  };
  const shown = (code: RuleIssueCode) => tried && issues.includes(code);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl" closeLabel={t('close')}>
        <SheetHeader>
          <SheetTitle>{isNew ? t('addTitle') : t('editTitle')}</SheetTitle>
          <SheetDescription>{t('sheetHint')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid gap-4 pb-6">
          <section aria-labelledby={`${uid}-when`} className="grid gap-2">
            <h3 id={`${uid}-when`} className="text-sm font-medium">
              {t('when')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('whenHint')}</p>
            <ConditionBuilder
              value={value.when}
              onChange={(when) => setValue((v) => ({ ...v, when }))}
              facts={facts}
              emptyText={t('whenEmpty')}
            />
          </section>
          <section aria-labelledby={`${uid}-require`} className="grid gap-2">
            <h3 id={`${uid}-require`} className="text-sm font-medium">
              {t('require')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('requireHint')}</p>
            <ConditionBuilder
              value={value.require}
              onChange={(require) => setValue((v) => ({ ...v, require }))}
              facts={facts}
              emptyText={t('requireEmpty')}
            />
            {(shown('requireEmpty') || shown('conditionIncomplete')) && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {t(shown('requireEmpty') ? 'issues.requireEmpty' : 'issues.conditionIncomplete')}
              </p>
            )}
          </section>
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-message`}>{t('message')}</Label>
            <LocalizedInput
              id={`${uid}-message`}
              value={value.message}
              invalid={shown('messageEmpty')}
              aria-describedby={`${uid}-message-hint`}
              placeholder={t('messagePlaceholder')}
              onChange={(message) => setValue((v) => ({ ...v, message }))}
            />
            <p id={`${uid}-message-hint`} className="text-xs text-muted-foreground">
              {shown('messageEmpty') ? (
                <span className="font-medium text-destructive">{t('issues.messageEmpty')}</span>
              ) : (
                t('messageHint')
              )}
            </p>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('showOn')}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t('showOnHint')}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {fields.map((f) => (
                <label
                  key={f.key}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
                >
                  <Checkbox
                    checked={value.fields.includes(f.key)}
                    onCheckedChange={(c) =>
                      setValue((v) => ({
                        ...v,
                        fields: c === true ? [...v.fields, f.key] : v.fields.filter((k) => k !== f.key),
                      }))
                    }
                  />
                  <span className="truncate">{localize(f.label, locale) || f.key}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {shown('unknownField') && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {t('issues.unknownField')}
            </p>
          )}
        </SheetBody>
        <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={save}>
            {isNew ? t('add') : t('apply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The Rules tab: checks across fields, run like field validation in the browser and by the API ("the end date is
 * after the start date", "a rollback plan is required when the risk is high"). Each rule has an optional "when", a
 * "require" condition, a message in the three languages and the fields it shows on (or above the form).
 */
export function FormRules({
  rules,
  fields,
  onChange,
  readOnly,
}: {
  rules: readonly FormRule[];
  fields: readonly FieldDef[];
  onChange: (rules: FormRule[], tag?: string) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations('forms.rules');
  const locale = useLocale();
  const today = useTodayFact();
  const facts = useMemo(() => [...fieldFacts(fields, locale), today], [fields, locale, today]);
  const conditionText = useConditionText(facts);
  const issues = useMemo(() => rulesIssues(rules, fields), [rules, fields]);
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const labelOf = (key: string) => {
    const f = fields.find((x) => x.key === key);
    return f ? localize(f.label, locale) || key : key;
  };
  const open = (rule: FormRule | null) =>
    setEditing({
      isNew: !rule,
      draft: rule
        ? { ...rule, fields: rule.fields ?? [] }
        : { id: newElementId('r'), message: {}, fields: [] },
    });

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {!readOnly && (
          <Button type="button" onClick={() => open(null)} disabled={!fields.length}>
            <PlusIcon /> {t('addRule')}
          </Button>
        )}
      </div>
      {!rules.length ? (
        <EmptyState
          icon={<ShieldCheckIcon />}
          title={t('emptyTitle')}
          description={fields.length ? t('emptyHint') : t('noFields')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <AnimatedList className="-mb-3" aria-label={t('title')}>
          {rules.map((rule) => {
            const problems = issues.get(rule.id) ?? [];
            const message = localize(rule.message, locale);
            return (
              <AnimatedItem key={rule.id} className="pb-3">
                <div className="grid gap-2 rounded-xl border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium break-words">
                        {message || <span className="text-muted-foreground italic">{t('noMessage')}</span>}
                      </p>
                      <p className="text-sm break-words text-muted-foreground">
                        {rule.when
                          ? t('summaryWhen', {
                              when: conditionText(rule.when),
                              require: conditionText(rule.require),
                            })
                          : t('summary', { require: conditionText(rule.require) })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {rule.fields?.length
                          ? t('shownOn', { fields: rule.fields.map(labelOf).join(', ') })
                          : t('shownAbove')}
                      </p>
                    </div>
                    {!readOnly && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('edit', { name: message || t('noMessage') })}
                          onClick={() => open(rule)}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove', { name: message || t('noMessage') })}
                          onClick={() => {
                            onChange(rules.filter((r) => r.id !== rule.id));
                            setAnnouncement(t('removed'));
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    )}
                  </div>
                  {problems.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {problems.map((code) => (
                        <Badge key={code} variant="destructive">
                          <TriangleAlertIcon aria-hidden /> {t(`issues.${code}`)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {editing && (
        <RuleSheet
          key={editing.draft.id}
          draft={editing.draft}
          isNew={editing.isNew}
          fields={fields}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            onChange(
              editing.isNew ? [...rules, rule] : rules.map((r) => (r.id === rule.id ? rule : r)),
              `rule-${rule.id}`,
            );
            setAnnouncement(editing.isNew ? t('added') : t('updated'));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
