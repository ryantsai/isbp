'use client';

import type { FormAudience, ProcessChecks, ProcessChecksInput } from '@isbp/contracts';
import {
  type ApproverRule,
  type FieldDef,
  localize,
  walkSteps,
  type WorkflowGraph,
  type WorkflowStep,
} from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import type { FactOption } from '@isbp/ui/condition-builder';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useRecordTypes } from '@/components/records/record-facts';
import { useRoleText } from '@/components/roles/role-utils';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

/** Where a check points, so "fix" can take you there. */
export type CheckTab = 'build' | 'approval' | 'settings';

export interface ProcessCheck {
  id: string;
  tab: CheckTab;
  /** The field (Questions) or step (Approval) it is about. */
  target?: string;
  message: string;
  fixes: { label: string; run: () => void }[];
}

/** Every approver rule of a graph, fallbacks included, with the step it belongs to. */
function approverRules(graph: WorkflowGraph | null) {
  const out: { step: WorkflowStep; rule: ApproverRule; top: ApproverRule }[] = [];
  for (const { step } of walkSteps(graph?.steps ?? [])) {
    if (step.type !== 'approval') continue;
    for (const top of step.approvers) {
      let rule: ApproverRule | undefined = top;
      while (rule) {
        out.push({ step, rule, top });
        rule = 'fallback' in rule ? rule.fallback : undefined;
      }
    }
  }
  return out;
}

type BuilderField = FieldDef & { id: string };

/** Record types a field offers, table columns included. */
function recordTypesOf(fields: readonly BuilderField[]) {
  const out: { field: BuilderField; types: string[] }[] = [];
  for (const f of fields) {
    if (f.type === 'record') out.push({ field: f, types: f.record?.types ?? [] });
    if (f.type === 'rows')
      for (const c of f.rows?.fields ?? [])
        if (c.type === 'record') out.push({ field: f, types: c.record?.types ?? [] });
  }
  return out;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

/**
 * "Before you publish": what would stop the process working for the people who use it. Record fields whose records
 * the audience can't see (they'd find nothing to pick), approvers taken from a field with nothing to fall back on
 * (an empty field rejects every request), groups without members and roles nobody holds. Warnings, not blockers.
 */
export function useProcessChecks({
  fields,
  audience,
  graph,
  facts,
  groupNames,
  enabled,
  go,
  skipStep,
}: {
  fields: readonly BuilderField[];
  audience: FormAudience;
  graph: WorkflowGraph | null;
  facts: readonly FactOption[];
  groupNames: Record<string, string>;
  enabled: boolean;
  /** Opens a tab (and selects the field or step). */
  go: (tab: CheckTab, target?: string) => void;
  /** Sets "If no approver is found" to "Skip this step" on a step. */
  skipStep?: (stepId: string) => void;
}): ProcessCheck[] {
  const t = useTranslations('forms.checks');
  const tr = useTranslations();
  const locale = useLocale();
  const api = useApi();
  const roleText = useRoleText();
  const { types } = useRecordTypes({ enabled, all: true });
  const rules = useMemo(() => approverRules(graph), [graph]);
  const recordFields = useMemo(() => recordTypesOf(fields), [fields]);
  const input = useDebounced(
    useMemo(
      () =>
        JSON.stringify({
          audience,
          recordTypes: [...new Set(recordFields.flatMap((r) => r.types))].sort(),
          groupKeys: [
            ...new Set(
              rules.flatMap(({ rule }) => (rule.type === 'group' && rule.groupKey ? [rule.groupKey] : [])),
            ),
          ].sort(),
          roleKeys: [
            ...new Set(
              rules.flatMap(({ rule }) => (rule.type === 'role' && rule.roleKey ? [rule.roleKey] : [])),
            ),
          ].sort(),
        } satisfies ProcessChecksInput),
      [audience, recordFields, rules],
    ),
    400,
  );
  const server = useQuery({
    queryKey: ['/forms/checks', input],
    queryFn: () => api.post<ProcessChecks>('/forms/checks', JSON.parse(input) as unknown),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const out: ProcessCheck[] = [];
    // `RecordTypeInfo.name` is an i18n key of the module that declares the type.
    const typeName = (type: string) => {
      const info = types.find((x) => x.type === type);
      return info && tr.has(info.name) ? tr(info.name) : type;
    };
    const fieldName = (f: FieldDef) => localize(f.label, locale) || f.key;
    const data = server.data;

    // Records the audience can't see.
    if (data)
      for (const { field, types: offered } of recordFields)
        for (const type of offered) {
          const r = data.records.find((x) => x.type === type);
          if (!r || r.reach === 'all') continue;
          const roles = r.roles.map((x) => roleText({ key: x.key, name: x.name, moduleId: x.moduleId }).name);
          const groups = r.groupsWithout.map((g) => g.name);
          out.push({
            id: `record:${field.id}:${type}`,
            tab: 'build',
            target: field.id,
            message:
              r.reach === 'none'
                ? t('recordsNobody', { field: fieldName(field), type: typeName(type) })
                : audience.type === 'groups' && groups.length
                  ? t('recordsGroups', {
                      field: fieldName(field),
                      type: typeName(type),
                      groups: groups.join(', '),
                      roles: roles[0] ?? '',
                    })
                  : t('recordsSome', {
                      field: fieldName(field),
                      type: typeName(type),
                      roles: roles[0] ?? '',
                    }),
            fixes: [
              { label: t('limitAudience'), run: () => go('settings') },
              { label: t('otherType'), run: () => go('build', field.id) },
            ],
          });
        }

    // Approvers that may find nobody.
    const stepName = (s: WorkflowStep) => localize(s.name, locale) || t('aStep');
    const seen = new Set<string>();
    for (const { step, rule, top } of rules) {
      if (step.type !== 'approval') continue;
      const lastResort = !('fallback' in rule && rule.fallback);
      const rejects = (step.ifNoApprover ?? 'reject') === 'reject';
      const only = step.approvers.length === 1;
      const key = `${step.id}:${JSON.stringify(rule)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (rule.type === 'fact' && rule.fact && lastResort && rejects && only && rule === top) {
        const label = facts.find((f) => f.path === rule.fact)?.label ?? rule.fact;
        out.push({
          id: `fact:${step.id}`,
          tab: 'approval',
          target: step.id,
          message: t('factNoFallback', { field: label, step: stepName(step) }),
          fixes: [
            { label: t('addFallback'), run: () => go('approval', step.id) },
            ...(skipStep ? [{ label: t('skipInstead'), run: () => skipStep(step.id) }] : []),
          ],
        });
      }
      if (!data || !lastResort) continue;
      if (rule.type === 'group' && rule.groupKey) {
        const g = data.groups.find((x) => x.key === rule.groupKey);
        if (g && g.members === 0)
          out.push({
            id: `group:${step.id}:${g.key}`,
            tab: 'approval',
            target: step.id,
            message: t('groupEmpty', { group: groupNames[g.key] ?? g.name, step: stepName(step) }),
            fixes: [{ label: t('openStep'), run: () => go('approval', step.id) }],
          });
      }
      if (rule.type === 'role' && rule.roleKey) {
        const r = data.roles.find((x) => x.key === rule.roleKey);
        if (r && r.holders === 0)
          out.push({
            id: `role:${step.id}:${r.key}`,
            tab: 'approval',
            target: step.id,
            message: t('roleEmpty', {
              role: roleText({ key: r.key, name: r.name, moduleId: r.moduleId }).name,
              step: stepName(step),
            }),
            fixes: [{ label: t('openStep'), run: () => go('approval', step.id) }],
          });
      }
    }
    return out;
  }, [
    server.data,
    recordFields,
    rules,
    types,
    locale,
    t,
    tr,
    roleText,
    audience.type,
    facts,
    groupNames,
    go,
    skipStep,
  ]);
}

/** The checks as a short list with their fixes ("Before you publish"). */
export function ProcessCheckList({
  checks,
  title,
  className,
}: {
  checks: readonly ProcessCheck[];
  title?: string;
  className?: string;
}) {
  const t = useTranslations('forms.checks');
  if (!checks.length) return null;
  return (
    <div className={className}>
      <Banner status="warning" title={title ?? t('title')} collapsible={false}>
        <AnimatedList>
          {checks.map((c) => (
            <AnimatedItem key={c.id} className="py-1.5">
              <Text as="p">{c.message}</Text>
              {c.fixes.length > 0 && (
                <HStack gap={3} wrap="wrap">
                  {c.fixes.map((f) => (
                    <Button label={f.label} variant="ghost" size="sm" key={f.label} onClick={f.run} />
                  ))}
                </HStack>
              )}
            </AnimatedItem>
          ))}
        </AnimatedList>
      </Banner>
    </div>
  );
}
