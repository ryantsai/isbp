'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import {
  type Condition,
  conditionFacts,
  type FieldDef,
  type FormRule,
  type LocalizedText,
  localize,
  RESERVED_FACTS,
} from '@isbp/sdk';
import { Card, CardContent } from '@isbp/ui/card';
import { ConditionBuilder, useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState } from '@isbp/ui/empty-state';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
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
        <SheetBody className="pb-6">
          <VStack gap={5}>
            <VStack as="section" gap={2} aria-labelledby={`${uid}-when`}>
              <Heading level={3} id={`${uid}-when`}>
                {t('when')}
              </Heading>
              <Text type="supporting">{t('whenHint')}</Text>
              <ConditionBuilder
                value={value.when}
                onChange={(when) => setValue((v) => ({ ...v, when }))}
                facts={facts}
                emptyText={t('whenEmpty')}
              />
            </VStack>
            <VStack as="section" gap={2} aria-labelledby={`${uid}-require`}>
              <Heading level={3} id={`${uid}-require`}>
                {t('require')}
              </Heading>
              <Text type="supporting">{t('requireHint')}</Text>
              <ConditionBuilder
                value={value.require}
                onChange={(require) => setValue((v) => ({ ...v, require }))}
                facts={facts}
                emptyText={t('requireEmpty')}
              />
              {(shown('requireEmpty') || shown('conditionIncomplete')) && (
                <FieldStatus
                  type="error"
                  variant="detached"
                  message={t(shown('requireEmpty') ? 'issues.requireEmpty' : 'issues.conditionIncomplete')}
                />
              )}
            </VStack>
            <Field
              label={t('message')}
              inputID={`${uid}-message`}
              description={t('messageHint')}
              status={
                shown('messageEmpty') ? { type: 'error', message: t('issues.messageEmpty') } : undefined
              }
              statusVariant="detached"
            >
              <LocalizedInput
                id={`${uid}-message`}
                value={value.message}
                invalid={shown('messageEmpty')}
                placeholder={t('messagePlaceholder')}
                onChange={(message) => setValue((v) => ({ ...v, message }))}
              />
            </Field>
            <CheckboxList
              label={t('showOn')}
              description={t('showOnHint')}
              value={value.fields}
              onChange={(keys) => setValue((v) => ({ ...v, fields: keys }))}
              status={
                shown('unknownField') ? { type: 'error', message: t('issues.unknownField') } : undefined
              }
            >
              {fields.map((f) => (
                <CheckboxListItem key={f.key} value={f.key} label={localize(f.label, locale) || f.key} />
              ))}
            </CheckboxList>
          </VStack>
        </SheetBody>
        <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button label={t('cancel')} variant="ghost" onClick={onClose} />
          <Button label={isNew ? t('add') : t('apply')} variant="primary" onClick={save} />
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
    <VStack gap={4} maxWidth={768} className="mx-auto w-full">
      <HStack gap={3} wrap="wrap" hAlign="between" vAlign="start">
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Heading level={2}>{t('title')}</Heading>
            <Text type="supporting">{t('description')}</Text>
          </VStack>
        </StackItem>
        {!readOnly && (
          <Button
            label={t('addRule')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={!fields.length}
            onClick={() => open(null)}
          />
        )}
      </HStack>
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
            const name = message || t('noMessage');
            return (
              <AnimatedItem key={rule.id} className="pb-3">
                <Card>
                  <CardContent>
                    <VStack gap={2}>
                      <HStack gap={3} vAlign="start">
                        <Icon icon={ShieldCheckIcon} color="accent" />
                        <StackItem size="fill">
                          <VStack gap={1}>
                            <Text weight="medium" wordBreak="break-word">
                              {name}
                            </Text>
                            <Text type="supporting" wordBreak="break-word">
                              {rule.when
                                ? t('summaryWhen', {
                                    when: conditionText(rule.when),
                                    require: conditionText(rule.require),
                                  })
                                : t('summary', { require: conditionText(rule.require) })}
                            </Text>
                            <Text type="supporting" size="xsm">
                              {rule.fields?.length
                                ? t('shownOn', { fields: rule.fields.map(labelOf).join(', ') })
                                : t('shownAbove')}
                            </Text>
                          </VStack>
                        </StackItem>
                        {!readOnly && (
                          <HStack gap={1}>
                            <IconButton
                              label={t('edit', { name })}
                              variant="ghost"
                              icon={<Icon icon={PencilIcon} />}
                              onClick={() => open(rule)}
                            />
                            <IconButton
                              label={t('remove', { name })}
                              variant="ghost"
                              icon={<Icon icon={Trash2Icon} />}
                              onClick={() => {
                                onChange(rules.filter((r) => r.id !== rule.id));
                                setAnnouncement(t('removed'));
                              }}
                            />
                          </HStack>
                        )}
                      </HStack>
                      {problems.length > 0 && (
                        <HStack gap={1.5} wrap="wrap">
                          {problems.map((code) => (
                            <Badge
                              variant="error"
                              label={t(`issues.${code}`)}
                              icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                              key={code}
                            />
                          ))}
                        </HStack>
                      )}
                    </VStack>
                  </CardContent>
                </Card>
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
    </VStack>
  );
}
