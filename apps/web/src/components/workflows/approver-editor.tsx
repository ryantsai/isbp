'use client';

import { APPROVER_TYPES, type ApproverRule, type ApproverType } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { cn } from '@isbp/ui';
import { CornerDownRightIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApproverText } from '@isbp/ui/workflow-diagram';
import { useId } from 'react';
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
  const id = useId();
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

  return (
    <div className={cn('grid gap-2', depth === 0 && 'rounded-lg border bg-card/60 p-3')}>
      <div className="flex items-start gap-2">
        {depth > 0 && (
          <CornerDownRightIcon className="mt-2.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="grid min-w-0 flex-1 gap-2">
          <Select
            value={choiceOf(rule)}
            disabled={readOnly}
            onValueChange={(v) =>
              onChange({
                ...emptyRule(v as Choice),
                ...(fallback && v !== 'requester' ? { fallback } : {}),
              } as ApproverRule)
            }
          >
            <SelectTrigger aria-label={t('type')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`types.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="min-w-0">
            {rule.type === 'user' && (
              <Label htmlFor={`${id}-user`} className="sr-only">
                {t('types.user')}
              </Label>
            )}
            {rule.type === 'user' && (
              <UserPicker
                id={`${id}-user`}
                value={rule.userId ? { id: rule.userId, displayName: names.users[rule.userId] ?? '…' } : null}
                onChange={(u) => {
                  if (u) remember('users', u.id, u.displayName);
                  onChange({ ...rule, userId: u?.id ?? '' });
                }}
              />
            )}
            {rule.type === 'group' && (
              <Label htmlFor={`${id}-group`} className="sr-only">
                {t('types.group')}
              </Label>
            )}
            {rule.type === 'group' && (
              <GroupPicker
                id={`${id}-group`}
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
              <Select
                value={rule.roleKey || undefined}
                disabled={readOnly}
                onValueChange={(v) => onChange({ ...rule, roleKey: v })}
              >
                <SelectTrigger aria-label={t('types.role')} className="w-full">
                  <SelectValue placeholder={t('pickRole')} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {rule.type === 'manager' && (
              <Select
                value={String(rule.level ?? 1)}
                disabled={readOnly}
                onValueChange={(v) => onChange({ ...rule, level: Number(v) })}
              >
                <SelectTrigger aria-label={t('level')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((l) => (
                    <SelectItem key={l} value={String(l)}>
                      {t('levels', { level: l })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {rule.type === 'fact' && (
              <Select
                value={rule.fact || undefined}
                disabled={readOnly}
                onValueChange={(v) => onChange({ ...rule, fact: v })}
              >
                <SelectTrigger
                  aria-label={groupKind ? t('types.fact-group') : t('types.fact')}
                  className="w-full"
                >
                  <SelectValue placeholder={groupKind ? t('pickGroupFact') : t('pickFact')} />
                </SelectTrigger>
                <SelectContent>
                  {idFacts.map((f) => (
                    <SelectItem key={f.path} value={f.path}>
                      {f.label}
                    </SelectItem>
                  ))}
                  {rule.fact && !idFacts.some((f) => f.path === rule.fact) && (
                    <SelectItem value={rule.fact}>{rule.fact}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            {groupKind && (
              <p className="pt-2 text-xs text-muted-foreground">
                {idFacts.length ? t('hints.fact-group') : t('noGroupFacts')}
              </p>
            )}
            {rule.type === 'fact' && depth === 0 && (
              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id={`${id}-each`}
                  checked={rule.each === true}
                  disabled={readOnly}
                  onCheckedChange={(v) => {
                    const { each: _each, ...rest } = rule;
                    onChange(v === true ? { ...rest, each: true } : rest);
                  }}
                  aria-describedby={`${id}-each-hint`}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`${id}-each`} className="text-sm font-normal">
                    {t('each')}
                  </Label>
                  <p id={`${id}-each-hint`} className="text-xs text-muted-foreground">
                    {t('eachHint')}
                  </p>
                </div>
              </div>
            )}
            {(rule.type === 'department-head' || rule.type === 'requester') && (
              <p className="pt-2 text-xs text-muted-foreground">{t(`hints.${rule.type}`)}</p>
            )}
          </div>
        </div>
        {onRemove && !readOnly && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={
              depth > 0
                ? t('removeFallback', { name: describe({ ...rule, fallback: undefined } as ApproverRule) })
                : t('removeApprover', { name: describe({ ...rule, fallback: undefined } as ApproverRule) })
            }
            onClick={onRemove}
          >
            {depth > 0 ? <XIcon /> : <Trash2Icon />}
          </Button>
        )}
      </div>
      {rule.type !== 'requester' && rule.type !== 'user' && (
        <div className={cn(depth > 0 && 'pl-6')}>
          {fallback ? (
            <div className="grid gap-1.5">
              <Label className="text-xs font-normal text-muted-foreground">{t('fallback')}</Label>
              <ApproverRuleEditor
                rule={fallback}
                onChange={setFallback}
                onRemove={() => setFallback(undefined)}
                depth={depth + 1}
              />
            </div>
          ) : (
            depth < 3 &&
            !readOnly && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setFallback({ type: 'role', roleKey: 'platform-admin' })}
              >
                <PlusIcon className="size-3" />
                {t('addFallback')}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
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
    <div className="grid gap-2">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => onChange([...rules, { type: 'group', groupKey: '' }])}
        >
          <PlusIcon />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
