'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Role, RoleRequestSettings, WorkflowDefinitionSummary } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import {
  HandIcon,
  HourglassIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  WorkflowIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useId } from 'react';
import { UserPicker } from '@/components/pickers/user-picker';
import { useApiQuery } from '@/lib/api';
import { Segmented } from '@isbp/ui/segmented';

/* ───────────────────────── badges ───────────────────────── */

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const RISK_ICON = { low: ShieldCheckIcon, medium: ShieldAlertIcon, high: TriangleAlertIcon } as const;
const RISK_VARIANT = { low: 'success', medium: 'warning', high: 'error' } as const;

/** Risk level — icon + text, never colour alone. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const t = useTranslations('roles.requestSettings.riskLevels');
  return (
    <Badge
      variant={RISK_VARIANT[level]}
      label={t(level)}
      icon={<Icon icon={RISK_ICON[level]} size="xsm" />}
    />
  );
}

export function RequestableBadge() {
  const t = useTranslations('roles.requestSettings.badges');
  return <Badge variant="info" label={t('requestable')} icon={<Icon icon={HandIcon} size="xsm" />} />;
}

/** "30 days" / "1 year" style duration. */
export function useDurationText() {
  const t = useTranslations('roles.requestSettings');
  return useCallback(
    (days: number) => (days % 365 === 0 ? t('years', { count: days / 365 }) : t('days', { count: days })),
    [t],
  );
}

export function MaxDurationBadge({ days }: { days: number }) {
  const t = useTranslations('roles.requestSettings.badges');
  const duration = useDurationText();
  return (
    <Badge
      variant="neutral"
      label={t('maxDuration', { duration: duration(days) })}
      icon={<Icon icon={HourglassIcon} size="xsm" />}
    />
  );
}

/** Requestable + risk (+ longest grant) — nothing for roles that can't be requested. */
export function RequestBadges({
  role,
  showDuration = false,
}: {
  role: Pick<Role, 'requestable' | 'riskLevel' | 'maxDurationDays'>;
  showDuration?: boolean;
}) {
  if (!role.requestable) return null;
  return (
    <>
      <RequestableBadge />
      <RiskBadge level={role.riskLevel} />
      {showDuration && role.maxDurationDays !== null && <MaxDurationBadge days={role.maxDurationDays} />}
    </>
  );
}

/* ───────────────────────── draft model ───────────────────────── */

const DURATIONS = ['none', '30', '90', '365', 'custom'] as const;
type Duration = (typeof DURATIONS)[number];

export interface RequestSettingsDraft {
  requestable: boolean;
  riskLevel: RiskLevel;
  owner: { id: string; displayName: string } | null;
  duration: Duration;
  customDays: string;
  requestWorkflow: { id: string; name: string } | null;
}

export const EMPTY_REQUEST_SETTINGS: RequestSettingsDraft = {
  requestable: false,
  riskLevel: 'low',
  owner: null,
  duration: 'none',
  customDays: '',
  requestWorkflow: null,
};

export function draftFromRole(
  role: Pick<Role, 'requestable' | 'riskLevel' | 'owner' | 'maxDurationDays' | 'requestWorkflow'>,
): RequestSettingsDraft {
  const days = role.maxDurationDays;
  const preset = days === null ? 'none' : (DURATIONS.find((d) => d === String(days)) ?? 'custom');
  return {
    requestable: role.requestable,
    riskLevel: role.riskLevel,
    owner: role.owner,
    duration: preset,
    customDays: preset === 'custom' && days !== null ? String(days) : '',
    requestWorkflow: role.requestWorkflow,
  };
}

function maxDays(d: RequestSettingsDraft): number | null {
  if (d.duration === 'none') return null;
  if (d.duration === 'custom') return Number(d.customDays.trim());
  return Number(d.duration);
}

/** True when the custom duration is a whole number of days within the API's range. */
export function isDraftValid(d: RequestSettingsDraft) {
  if (d.duration !== 'custom') return true;
  const raw = d.customDays.trim();
  const n = Number(raw);
  return /^\d+$/.test(raw) && n >= 1 && n <= 3650;
}

export function draftToBody(d: RequestSettingsDraft): RoleRequestSettings {
  return {
    requestable: d.requestable,
    riskLevel: d.riskLevel,
    ownerId: d.owner?.id ?? null,
    maxDurationDays: maxDays(d),
    requestWorkflowId: d.requestWorkflow?.id ?? null,
  };
}

export function draftEquals(a: RequestSettingsDraft, b: RequestSettingsDraft) {
  const x = draftToBody(a);
  const y = draftToBody(b);
  return (
    x.requestable === y.requestable &&
    x.riskLevel === y.riskLevel &&
    x.ownerId === y.ownerId &&
    x.maxDurationDays === y.maxDurationDays &&
    x.requestWorkflowId === y.requestWorkflowId
  );
}

/* ───────────────────────── workflows ───────────────────────── */

/** Published access-request workflows (empty when you can't read workflows). */
export function useAccessRequestWorkflows(enabled = true) {
  const canRead = useCan('core.workflows.read');
  const q = useApiQuery<{ items: WorkflowDefinitionSummary[] }>(enabled && canRead ? '/workflows' : null, {
    triggerKey: 'core.access-request',
  });
  const items = (q.data?.items ?? []).filter((w) => w.publishedVersion !== null && !w.archived);
  return { items, isLoading: q.isLoading && canRead, canRead };
}

/** Workflow names may be i18n keys (system workflows). */
export function useWorkflowName() {
  const t = useTranslations();
  return useCallback((name: string) => (t.has(name) ? t(name) : name), [t]);
}

/* ───────────────────────── editor ───────────────────────── */

const DEFAULT_WORKFLOW = '__default__';

/**
 * Controlled editor for a role's self-service settings. The details only matter once the role is
 * requestable, so they fold away until then.
 */
export function RequestSettingsFields({
  value,
  onChange,
  disabled,
  showErrors,
}: {
  value: RequestSettingsDraft;
  onChange: (next: RequestSettingsDraft) => void;
  disabled?: boolean;
  /** Show the custom-duration error (after a submit attempt). */
  showErrors?: boolean;
}) {
  const t = useTranslations('roles.requestSettings');
  const id = useId();
  const workflows = useAccessRequestWorkflows();
  const workflowName = useWorkflowName();
  const set = (patch: Partial<RequestSettingsDraft>) => onChange({ ...value, ...patch });
  const durationInvalid = showErrors && !isDraftValid(value);
  const defaultWorkflow = workflows.items.find((w) => w.isDefault);
  const current = value.requestWorkflow;
  const listed = workflows.items.filter((w) => !w.isDefault);
  // Keep the saved override selectable even when the list can't be loaded.
  const extra = current && !workflows.items.some((w) => w.id === current.id) ? [current] : [];
  const workflowOptions = [
    {
      value: DEFAULT_WORKFLOW,
      label: defaultWorkflow
        ? t('workflowDefaultNamed', { name: workflowName(defaultWorkflow.name) })
        : t('workflowDefault'),
    },
    ...(listed.length + extra.length > 0 ? [{ type: 'divider' as const }] : []),
    ...[...listed, ...extra].map((w) => ({ value: w.id, label: workflowName(w.name) })),
  ];

  return (
    <VStack gap={5}>
      <Switch
        label={t('requestable')}
        description={value.requestable ? t('requestableHint') : t('notRequestableHint')}
        value={value.requestable}
        onChange={(v) => set({ requestable: v })}
        isDisabled={disabled}
      />

      <AnimatePresence initial={false}>
        {value.requestable && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-0.5 pb-0.5">
              <VStack gap={5}>
                <Field
                  label={t('risk')}
                  isGroupLabel
                  labelID={`${id}-risk`}
                  inputID={`${id}-risk-input`}
                  description={t('riskHint')}
                >
                  <SegmentedControl
                    label={t('risk')}
                    value={value.riskLevel}
                    onChange={(v) => set({ riskLevel: v as RiskLevel })}
                    isDisabled={disabled}
                  >
                    {RISK_LEVELS.map((r) => (
                      <SegmentedControlItem
                        key={r}
                        value={r}
                        label={t(`riskShort.${r}`)}
                        icon={<Icon icon={RISK_ICON[r]} />}
                      />
                    ))}
                  </SegmentedControl>
                </Field>

                <Field label={t('owner')} inputID={`${id}-owner`} description={t('ownerHint')}>
                  <UserPicker
                    id={`${id}-owner`}
                    value={value.owner}
                    onChange={(u) => set({ owner: u ? { id: u.id, displayName: u.displayName } : null })}
                    placeholder={t('ownerPlaceholder')}
                  />
                </Field>

                <Field
                  label={t('maxDuration')}
                  isGroupLabel
                  labelID={`${id}-duration`}
                  inputID={`${id}-duration-input`}
                  description={t('maxDurationHint')}
                >
                  <VStack gap={2}>
                    <Segmented
                      label={t('maxDuration')}
                      value={value.duration}
                      onChange={(v) => set({ duration: v })}
                      disabled={disabled}
                      options={DURATIONS.map((d) => ({ value: d, label: t(`duration.${d}`) }))}
                    />
                    <AnimatePresence initial={false}>
                      {value.duration === 'custom' && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-0.5 pt-1 pb-0.5">
                            <HStack gap={2} vAlign="start">
                              <TextInput
                                label={t('customDays')}
                                isLabelHidden
                                value={value.customDays}
                                onChange={(v) => set({ customDays: v.replace(/[^\d]/g, '') })}
                                isDisabled={disabled}
                                status={
                                  durationInvalid ? { type: 'error', message: t('daysInvalid') } : undefined
                                }
                                placeholder="60"
                                width={160}
                              />
                              <div className="pt-1.5">
                                <Text color="secondary">{t('daysUnit')}</Text>
                              </div>
                            </HStack>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </VStack>
                </Field>

                <Selector
                  label={t('workflow')}
                  description={t('workflowHint')}
                  value={current?.id ?? DEFAULT_WORKFLOW}
                  onChange={(v) => {
                    if (v === DEFAULT_WORKFLOW) return set({ requestWorkflow: null });
                    const w = [...workflows.items, ...extra].find((x) => x.id === v);
                    if (w) set({ requestWorkflow: { id: w.id, name: w.name } });
                  }}
                  options={workflowOptions}
                  isDisabled={disabled}
                />
              </VStack>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </VStack>
  );
}

/* ───────────────────────── read-only summary ───────────────────────── */

export function RequestSettingsSummary({
  role,
}: {
  role: Pick<Role, 'requestable' | 'riskLevel' | 'owner' | 'maxDurationDays' | 'requestWorkflow'>;
}) {
  const t = useTranslations('roles.requestSettings');
  const duration = useDurationText();
  const workflowName = useWorkflowName();
  if (!role.requestable) {
    return (
      <HStack gap={2} vAlign="start">
        <Icon icon={HandIcon} color="secondary" />
        <StackItem size="fill">
          <Text color="secondary">{t('notRequestableHint')}</Text>
        </StackItem>
      </HStack>
    );
  }
  return (
    <MetadataList>
      <MetadataListItem label={t('requestableShort')}>
        <RequestableBadge />
      </MetadataListItem>
      <MetadataListItem label={t('risk')}>
        <RiskBadge level={role.riskLevel} />
      </MetadataListItem>
      <MetadataListItem label={t('owner')}>
        {role.owner ? (
          <HStack gap={2} vAlign="center">
            <UserAvatar name={role.owner.displayName} className="size-5 text-[9px]" />
            <Text maxLines={1}>{role.owner.displayName}</Text>
          </HStack>
        ) : (
          <Text color="secondary">{t('noOwner')}</Text>
        )}
      </MetadataListItem>
      <MetadataListItem label={t('maxDuration')}>
        {role.maxDurationDays === null ? (
          <Text color="secondary">{t('duration.none')}</Text>
        ) : (
          duration(role.maxDurationDays)
        )}
      </MetadataListItem>
      <MetadataListItem label={t('workflow')}>
        <HStack gap={1.5} vAlign="center">
          <Icon icon={WorkflowIcon} size="sm" color="secondary" />
          <Text maxLines={1}>
            {role.requestWorkflow ? workflowName(role.requestWorkflow.name) : t('workflowDefault')}
          </Text>
        </HStack>
      </MetadataListItem>
    </MetadataList>
  );
}
