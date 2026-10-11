'use client';

import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { APPROVER_TYPES, type ApproverRule, type ApproverType } from '@isbp/sdk';
import { useApproverText } from '@isbp/ui/workflow-diagram';
import { CornerDownRightIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UserPicker } from '../pickers/user-picker';
import { GroupPicker } from '../roles/group-picker';
import { useBuilder } from './builder-context';

/** The type picker's choices: the approver types, with "a group from a fact" next to "a person from a fact". */
type Choice = ApproverType | 'fact-group';

const choiceOf = (rule: ApproverRule): Choice =>
  rule.type === 'fact' && rule.kind === 'group' ? 'fact-group' : rule.type;

function emptyRule(type: Choice): ApproverRule {
  switch (type) {
    case 'fact-group':
      return { type: 'fact', fact: '', kind: 'group' };
    case 'user':
      return { type, userId: '' };
    case 'group':
      return { type, groupKey: '' };
    case 'role':
      return { type, roleKey: '' };
    case 'manager':
      return { type, level: 1 };
    case 'fact':
      return { type, fact: '' };
    case 'department-head':
      return { type };
    case 'requester':
      return { type };
  }
}

/** One approver slot: who (person, group, role, manager, …) and who to ask if nobody is found. */
export function ApproverRuleEditor({
  rule,
  onChange,
  onRemove,
  allowRequester,
  depth = 0,
}: {
  rule: ApproverRule;
  onChange: (rule: ApproverRule) => void;
  onRemove?: () => void;
  allowRequester?: boolean;
  depth?: number;
}) {
  const t = useTranslations('workflows.builder.approvers');
  const { facts, names, roles, remember, readOnly } = useBuilder();
  const describe = useApproverText({ ...names, facts });
  const types = APPROVER_TYPES.filter((x) => x !== 'requester' || allowRequester).flatMap((x): Choice[] =>
    x === 'fact' ? ['fact', 'fact-group'] : [x],
  );
  const groupKind = rule.type === 'fact' && rule.kind === 'group';
  const idFacts = groupKind
    ? facts.filter((f) => f.ref === 'group')
    : facts.filter((f) => f.type === 'id' || f.ref === 'user');
  const fallback = 'fallback' in rule ? rule.fallback : undefined;
  const setFallback = (f: ApproverRule | undefined) => {
    if (rule.type === 'requester') return;
    const { fallback: _old, ...rest } = rule as ApproverRule & { fallback?: ApproverRule };
    onChange((f ? { ...rest, fallback: f } : rest) as ApproverRule);
  };

  const editor = (
    <VStack gap={2}>
      <HStack gap={2} vAlign="start">
        {depth > 0 && (
          <span className="mt-2.5 shrink-0">
            <Icon icon={CornerDownRightIcon} color="secondary" />
          </span>
        )}
        <StackItem size="fill" className="min-w-0">
          <VStack gap={2}>
            <Selector
              label={t('type')}
              isLabelHidden
              width="100%"
              value={choiceOf(rule)}
              isDisabled={readOnly}
              options={types.map((type) => ({ value: type, label: t(`types.${type}`) }))}
              onChange={(v) =>
                onChange({
                  ...emptyRule(v as Choice),
                  ...(fallback && v !== 'requester' ? { fallback } : {}),
                } as ApproverRule)
              }
            />
            {rule.type === 'user' && (
              <UserPicker
                aria-label={t('types.user')}
                value={rule.userId ? { id: rule.userId, displayName: names.users[rule.userId] ?? '…' } : null}
                onChange={(u) => {
                  if (u) remember('users', u.id, u.displayName);
                  onChange({ ...rule, userId: u?.id ?? '' });
                }}
              />
            )}
            {rule.type === 'group' && (
              <GroupPicker
                aria-label={t('types.group')}
                value={
                  rule.groupKey
                    ? {
                        id: rule.groupKey,
                        key: rule.groupKey,
                        name: names.groups[rule.groupKey] ?? rule.groupKey,
                      }
                    : null
                }
                onChange={(g) => {
                  if (g?.key) remember('groups', g.key, g.name);
                  onChange({ ...rule, groupKey: g?.key ?? '' });
                }}
              />
            )}
            {rule.type === 'role' && (
              <Selector
                label={t('types.role')}
                isLabelHidden
                width="100%"
                placeholder={t('pickRole')}
                value={rule.roleKey || undefined}
                isDisabled={readOnly}
                hasSearch={roles.length > 12}
                options={roles.map((r) => ({ value: r.key, label: r.name }))}
                onChange={(v) => onChange({ ...rule, roleKey: v })}
              />
            )}
            {rule.type === 'manager' && (
              <Selector
                label={t('level')}
                isLabelHidden
                width="100%"
                value={String(rule.level ?? 1)}
                isDisabled={readOnly}
                options={[1, 2, 3].map((l) => ({ value: String(l), label: t('levels', { level: l }) }))}
                onChange={(v) => onChange({ ...rule, level: Number(v) })}
              />
            )}
            {rule.type === 'fact' && (
              <Selector
                label={groupKind ? t('types.fact-group') : t('types.fact')}
                isLabelHidden
                width="100%"
                placeholder={groupKind ? t('pickGroupFact') : t('pickFact')}
                value={rule.fact || undefined}
                isDisabled={readOnly}
                hasSearch={idFacts.length > 12}
                options={[
                  ...idFacts.map((f) => ({ value: f.path, label: f.label })),
                  ...(rule.fact && !idFacts.some((f) => f.path === rule.fact)
                    ? [{ value: rule.fact, label: rule.fact }]
                    : []),
                ]}
                onChange={(v) => onChange({ ...rule, fact: v })}
              />
            )}
            {groupKind && (
              <Text type="supporting" color="secondary">
                {idFacts.length ? t('hints.fact-group') : t('noGroupFacts')}
              </Text>
            )}
            {rule.type === 'fact' && depth === 0 && (
              <CheckboxInput
                label={t('each')}
                description={t('eachHint')}
                value={rule.each === true}
                isDisabled={readOnly}
                onChange={(v) => {
                  const { each: _each, ...rest } = rule;
                  onChange(v === true ? { ...rest, each: true } : rest);
                }}
              />
            )}
            {(rule.type === 'department-head' || rule.type === 'requester') && (
              <Text type="supporting" color="secondary">
                {t(`hints.${rule.type}`)}
              </Text>
            )}
          </VStack>
        </StackItem>
        {onRemove && !readOnly && (
          <IconButton
            variant="ghost"
            label={
              depth > 0
                ? t('removeFallback', { name: describe({ ...rule, fallback: undefined } as ApproverRule) })
                : t('removeApprover', { name: describe({ ...rule, fallback: undefined } as ApproverRule) })
            }
            icon={<Icon icon={depth > 0 ? XIcon : Trash2Icon} />}
            onClick={onRemove}
          />
        )}
      </HStack>
      {rule.type !== 'requester' && rule.type !== 'user' && (
        <div className={depth > 0 ? 'pl-6' : undefined}>
          {fallback ? (
            <VStack gap={1.5}>
              <Text type="supporting" color="secondary">
                {t('fallback')}
              </Text>
              <ApproverRuleEditor
                rule={fallback}
                onChange={setFallback}
                onRemove={() => setFallback(undefined)}
                depth={depth + 1}
              />
            </VStack>
          ) : (
            depth < 3 &&
            !readOnly && (
              <HStack>
                <Button
                  label={t('addFallback')}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setFallback({ type: 'role', roleKey: 'platform-admin' })}
                />
              </HStack>
            )
          )}
        </div>
      )}
    </VStack>
  );

  return depth === 0 ? <Card padding={3}>{editor}</Card> : editor;
}

/** A list of approver slots with "add approver". */
export function ApproverList({
  rules,
  onChange,
  allowRequester,
  addLabel,
}: {
  rules: ApproverRule[];
  onChange: (rules: ApproverRule[]) => void;
  allowRequester?: boolean;
  addLabel: string;
}) {
  const { readOnly } = useBuilder();
  return (
    <VStack gap={2}>
      {rules.map((r, i) => (
        <ApproverRuleEditor
          key={i}
          rule={r}
          allowRequester={allowRequester}
          onChange={(next) => onChange(rules.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(rules.filter((_, j) => j !== i))}
        />
      ))}
      {!readOnly && (
        <HStack>
          <Button
            label={addLabel}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => onChange([...rules, { type: 'group', groupKey: '' }])}
          />
        </HStack>
      )}
    </VStack>
  );
}
