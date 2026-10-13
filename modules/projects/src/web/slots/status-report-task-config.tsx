'use client';

import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { TaskConfigSlotProps } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import type { ReportTemplate } from '../../contracts';

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Config editor of the `projects.status-report` task type in Scheduled Jobs (`scheduler.task-config.projects.status-report`):
 * which template, scope and period, and who is told the report is ready.
 */
export default function StatusReportTaskConfig({ value, onChange, errors, disabled }: TaskConfigSlotProps) {
  const t = useTranslations('projects.taskConfig');
  const tr = useTranslations('projects.report');
  const locale = useLocale();
  const peopleId = useId();
  const templates = useApiQuery<{ items: ReportTemplate[] }>('/projects/report-templates');
  const groups = useApiQuery<{ items: { id: string; key: string; name: string }[] }>(
    '/projects/lookups/groups',
  );
  const scope = value.scope === 'department' ? 'department' : 'all';
  const departments = useApiQuery<{ items: { id: string; name: string }[] }>(
    scope === 'department' ? '/projects/lookups/departments' : null,
  );
  const groupKeys = strings(value.groupKeys);
  const userIds = strings(value.userIds);
  const people = usePeople(userIds);
  const err = (k: string) => (errors?.[k] ? ({ type: 'error', message: errors[k]! } as const) : undefined);
  const patch = (p: Record<string, unknown>) => onChange({ ...value, ...p });

  return (
    <VStack gap={3} className="min-w-0">
      <Selector
        label={t('template')}
        isDisabled={disabled}
        value={typeof value.template === 'string' ? value.template : ''}
        placeholder={t('pickTemplate')}
        status={err('template')}
        onChange={(v) => patch({ template: v })}
        options={(templates.data?.items ?? []).map((tpl) => ({
          value: tpl.key,
          label: localize(tpl.name, locale),
        }))}
      />
      <Selector
        label={t('period')}
        description={t('periodHint')}
        isDisabled={disabled}
        value={value.period === 'current' ? 'current' : 'previous'}
        onChange={(v) => patch({ period: v })}
        options={(['previous', 'current'] as const).map((p) => ({ value: p, label: t(`periods.${p}`) }))}
      />
      <Selector
        label={tr('scope')}
        isDisabled={disabled}
        value={scope}
        onChange={(v) => patch({ scope: v, departmentId: v === 'department' ? value.departmentId : null })}
        options={[
          { value: 'all', label: t('scopeAll') },
          { value: 'department', label: tr('scopes.department') },
        ]}
      />
      {scope === 'department' && (
        <Selector
          label={tr('department')}
          hasSearch
          isDisabled={disabled}
          value={typeof value.departmentId === 'string' ? value.departmentId : ''}
          placeholder={tr('chooseDepartment')}
          status={err('departmentId')}
          onChange={(v) => patch({ departmentId: v })}
          options={(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
      )}
      <MultiSelector
        label={t('groups')}
        hasSearch
        triggerDisplay="badges"
        isDisabled={disabled}
        value={groupKeys}
        placeholder={t('pickGroups')}
        onChange={(v) => patch({ groupKeys: v })}
        options={(groups.data?.items ?? []).map((g) => ({ value: g.key, label: g.name }))}
      />
      {errors?.groupKeys && <Text type="supporting">{errors.groupKeys}</Text>}
      <Field label={t('people')} inputID={peopleId} isOptional description={t('peopleHint')}>
        <VStack gap={2}>
          {userIds.length > 0 && (
            <ul className="grid gap-1.5">
              {userIds.map((id) => {
                const p = people.get(id);
                return (
                  <li key={id}>
                    <HStack gap={2} vAlign="center">
                      <UserAvatar
                        name={p?.displayName ?? '…'}
                        src={p?.avatarUrl}
                        className="size-6 text-[10px]"
                      />
                      <span className="min-w-0 grow truncate">
                        <Text>{p?.displayName ?? '…'}</Text>
                      </span>
                      <IconButton
                        label={t('removePerson', { name: p?.displayName ?? '' })}
                        icon={<Icon icon={XIcon} />}
                        variant="ghost"
                        size="sm"
                        isDisabled={disabled}
                        onClick={() => patch({ userIds: userIds.filter((x) => x !== id) })}
                      />
                    </HStack>
                  </li>
                );
              })}
            </ul>
          )}
          <PersonPicker
            id={peopleId}
            value={null}
            disabled={disabled}
            excludeIds={userIds}
            placeholder={t('addPerson')}
            onChange={(p) => p && patch({ userIds: [...userIds, p.id] })}
          />
        </VStack>
      </Field>
    </VStack>
  );
}
