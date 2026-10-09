'use client';

import type { Group, RecordTypeInfo, Role, WorkflowTrigger } from '@isbp/contracts';
import {
  type ApproverRule,
  childBranches,
  type FieldDef,
  type FormAction,
  type FormSchema,
  formFields,
  localize,
  type Page,
  type WorkflowStep,
} from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { REF_PREFIX } from '../../contracts';
import { formsUsing, type PlanItem, PROCESS_KIND, WORKFLOW_KIND, workflowItemOf } from '../../lib/processes';
import { isRecord } from '../lib';

/*
 * Plain sentences for the changes of a change set or a package, built per kind from the proposed values: "6
 * questions, for everyone. Approval: the requester's manager → Network administrators. After approval: Raise a
 * ticket." Names come from the set itself (a group it creates, the form proposed with a workflow) and the live
 * directory where the viewer may read it; codes and ids are never shown.
 */

const GROUP_KIND = 'core.group';

type Text = Record<string, unknown> | string | null | undefined;

/** What the sentences need beyond the items: names of what already exists. */
export interface DescribeNames {
  groups: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
  people: ReadonlyMap<string, string>;
  triggers: ReadonlyMap<string, string>;
  workflows: ReadonlyMap<string, string>;
  /** Record type → fact path → label. */
  recordFacts: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** People a set of workflow values names directly (approvers, recipients, fallbacks). */
function userIdsIn(items: readonly PlanItem[]): string[] {
  const out: string[] = [];
  const rule = (r: ApproverRule) => {
    if (r.type === 'user') out.push(r.userId);
    if ('fallback' in r && r.fallback) rule(r.fallback);
  };
  for (const item of items) {
    if (item.kind !== WORKFLOW_KIND || !isRecord(item.value)) continue;
    const graph = item.value.graph as { steps?: WorkflowStep[] } | undefined;
    for (const step of flatSteps(graph?.steps ?? [])) step.approvers.forEach(rule);
  }
  return out;
}

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Names of the groups, roles, people, triggers, workflows and record facts the items mention, from the platform
 * where the viewer may read them, and from the items themselves (a group the set creates).
 */
export function useDescribeNames(items: readonly PlanItem[]): DescribeNames {
  const t = useTranslations();
  const locale = useLocale();
  const canGroups = useCan('core.groups.read');
  const canRoles = useCan('core.roles.read');
  const canWorkflows = useCan('core.workflows.read');
  const hasWorkflows = items.some((i) => i.kind === WORKFLOW_KIND);
  const hasForms = items.some((i) => i.kind === PROCESS_KIND);
  const groups = useApiQuery<Page<Group>>(canGroups ? '/groups' : null, { pageSize: 100 });
  const roles = useApiQuery<{ items: Role[] }>(canRoles && hasWorkflows ? '/roles' : null);
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>(
    canWorkflows && hasWorkflows ? '/workflow-triggers' : null,
  );
  const workflows = useApiQuery<{ items: { id: string; name: string }[] }>(
    canWorkflows && hasForms ? '/workflows' : null,
  );
  const types = useApiQuery<{ items: RecordTypeInfo[] }>(hasWorkflows ? '/records/types' : null, {
    all: 'true',
  });
  const userIds = useMemo(() => userIdsIn(items), [items]);
  const people = usePeople(userIds);

  return useMemo(() => {
    const text = (key: string) => (t.has(key) ? t(key) : key);
    const groupNames = new Map<string, string>(
      (groups.data?.items ?? []).map((g) => [g.key, g.name] as const),
    );
    for (const i of items)
      if (i.kind === GROUP_KIND && i.op !== 'delete' && isRecord(i.value) && typeof i.value.key === 'string')
        groupNames.set(i.value.key, localize(i.value.name as Text as never, locale) || i.label);
    const roleNames = new Map<string, string>();
    for (const r of roles.data?.items ?? []) {
      if (!r.application.isPlatform) continue;
      const base = r.moduleId === null ? null : `${r.moduleId ?? 'core'}.systemRoles.${r.key}.name`;
      roleNames.set(r.key, base && t.has(base) ? t(base) : r.name);
    }
    const recordFacts = new Map<string, Map<string, string>>();
    for (const type of types.data?.items ?? [])
      recordFacts.set(
        type.type,
        new Map(type.facts.map((f) => [f.path, f.label ? text(f.label) : humanise(f.path)] as const)),
      );
    return {
      groups: groupNames,
      roles: roleNames,
      people: new Map([...people].map(([id, p]) => [id, p.displayName] as const)),
      triggers: new Map((triggers.data?.items ?? []).map((x) => [x.key, text(x.name)] as const)),
      workflows: new Map((workflows.data?.items ?? []).map((w) => [w.id, text(w.name)] as const)),
      recordFacts,
    };
  }, [items, groups.data, roles.data, triggers.data, workflows.data, types.data, people, t, locale]);
}

/** `ownerId` → "Owner id"; the last segment of a path, in words. */
function humanise(path: string): string {
  const words = (path.split('.').pop() ?? path).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Approval steps in order, nested ones too (`conditional` when they only run in some cases). */
function flatSteps(
  steps: readonly WorkflowStep[],
  conditional = false,
): (Extract<WorkflowStep, { type: 'approval' }> & { conditional: boolean })[] {
  return steps.flatMap((step) => {
    const own = step.type === 'approval' ? [{ ...step, conditional: conditional || Boolean(step.when) }] : [];
    const nested = childBranches(step).flatMap((b) =>
      flatSteps(b.steps, conditional || step.type === 'condition' || Boolean(step.when)),
    );
    return [...own, ...nested];
  });
}

/** The fields of a form value. */
function fieldsOf(value: unknown): FieldDef[] {
  if (!isRecord(value) || !isRecord(value.schema)) return [];
  return formFields(value.schema as unknown as FormSchema);
}

/**
 * A function that describes one item in a few plain sentences (empty when there is nothing to add to its name and
 * kind). `items` is the whole set, so a form can name its proposed workflow's approvers and a workflow the form
 * proposed with it.
 */
export function useDescribe(items: readonly PlanItem[], names: DescribeNames) {
  const t = useTranslations('assistant.describe');
  const root = useTranslations();
  const locale = useLocale();
  const format = useFormatter();

  return useCallback(
    (item: PlanItem): string[] => {
      const v = item.value;
      if (item.op === 'archive' || item.op === 'delete' || !isRecord(v)) return [];
      const loc = (x: unknown) => localize(x as never, locale);
      const list = (xs: string[], type: 'conjunction' | 'disjunction' = 'conjunction') =>
        format.list(xs, { type });

      /** A fact path as words, with the fields of `fields` (a form's answers, the records picked in them). */
      const factText = (path: string, fields: readonly FieldDef[]): string => {
        const [root0, key, ...rest] = path.split('.');
        const field = fields.find((f) => f.key === key);
        const fieldLabel = field ? loc(field.label) || field.key : null;
        if (root0 === 'records' && field && rest.length) {
          const factPath = rest.join('.');
          const types = field.record?.types ?? [];
          const fact =
            types.map((ty) => names.recordFacts.get(ty)?.get(factPath)).find(Boolean) ?? humanise(factPath);
          return t('recordFact', { fact, field: fieldLabel! });
        }
        if (root0 === 'data' && fieldLabel) return t('fieldValue', { field: fieldLabel });
        return humanise(path);
      };

      const approverText = (rule: ApproverRule, fields: readonly FieldDef[]): string => {
        let own: string;
        switch (rule.type) {
          case 'manager':
            own = t('approver.manager', { level: String(rule.level ?? 1) });
            break;
          case 'department-head':
            own = t('approver.departmentHead');
            break;
          case 'requester':
            own = t('approver.requester');
            break;
          case 'group':
            own = names.groups.get(rule.groupKey) ?? t('approver.someGroup');
            break;
          case 'role':
            own = t('approver.role', { name: names.roles.get(rule.roleKey) ?? humanise(rule.roleKey) });
            break;
          case 'user':
            own = names.people.get(rule.userId) ?? t('approver.somePerson');
            break;
          case 'fact':
            own = factText(rule.fact, fields);
            break;
        }
        return 'fallback' in rule && rule.fallback
          ? t('approver.fallback', { rule: own, fallback: approverText(rule.fallback, fields) })
          : own;
      };

      /** "the requester's manager → Network administrators (in some cases)". */
      const stepsText = (graph: unknown, fields: readonly FieldDef[]): string | null => {
        const steps = isRecord(graph) && Array.isArray(graph.steps) ? (graph.steps as WorkflowStep[]) : [];
        const approvals = flatSteps(steps);
        if (!approvals.length) return null;
        return approvals
          .map((s) => {
            const who = list(
              s.approvers.map((a) => approverText(a, fields)),
              s.mode === 'all' ? 'conjunction' : 'disjunction',
            );
            return s.conditional ? t('inSomeCases', { step: who }) : who;
          })
          .join(' → ');
      };

      const out: string[] = [];
      if (item.kind === PROCESS_KIND) {
        const fields = fieldsOf(v);
        const audience = isRecord(v.audience) ? v.audience : { type: 'everyone' };
        const groupKeys = Array.isArray(audience.groupKeys) ? (audience.groupKeys as string[]) : [];
        out.push(
          t('form', {
            questions: fields.length,
            audience:
              audience.type === 'groups' && groupKeys.length
                ? list(groupKeys.map((k) => names.groups.get(k) ?? t('approver.someGroup')))
                : t('everyone'),
          }),
        );
        const workflowId = typeof v.workflowId === 'string' ? v.workflowId : null;
        const workflow = workflowItemOf(item, items);
        if (workflow) {
          const steps = stepsText(isRecord(workflow.value) ? workflow.value.graph : null, fields);
          out.push(steps ? t('approval', { steps }) : t('noApprovalSteps'));
        } else if (workflowId && !workflowId.startsWith(REF_PREFIX))
          out.push(
            names.workflows.has(workflowId)
              ? t('approvalNamed', { name: names.workflows.get(workflowId)! })
              : t('approvalExisting'),
          );
        else if (!workflowId) out.push(t('noApproval'));
        const actions = (
          isRecord(v.schema) && Array.isArray(v.schema.actions) ? v.schema.actions : []
        ) as FormAction[];
        for (const on of ['submitted', 'approved', 'rejected'] as const) {
          const these = actions.filter((a) => a.on === on);
          if (!these.length) continue;
          const actionNames = these.map((a) => {
            const named = a.name ? loc(a.name) : '';
            if (named) return named;
            const dot = a.type.indexOf('.');
            const key = `${a.type.slice(0, dot)}.processActions.${camel(a.type.slice(dot + 1))}.name`;
            return root.has(key) ? root(key) : humanise(a.type);
          });
          out.push(t('actions', { on, actions: list(actionNames) }));
        }
        return out;
      }

      if (item.kind === WORKFLOW_KIND) {
        const forms = formsUsing(item, items);
        const fields = forms.flatMap((f) => fieldsOf(f.value));
        const trigger = typeof v.triggerKey === 'string' ? v.triggerKey : null;
        if (forms.length)
          out.push(
            t('workflowFor', {
              forms: list(forms.map((f) => (isRecord(f.value) ? loc(f.value.name) : '') || f.label)),
            }),
          );
        else if (trigger && names.triggers.has(trigger))
          out.push(t('workflowTrigger', { trigger: names.triggers.get(trigger)! }));
        const steps = stepsText(v.graph, fields);
        out.push(steps ? t('approval', { steps }) : t('noApprovalSteps'));
        return out;
      }

      if (item.kind === GROUP_KIND && item.op === 'create') out.push(t('groupMembers'));
      const description = loc(v.description);
      if (description) out.push(description);
      return out;
    },
    [items, names, t, root, locale, format],
  );
}
