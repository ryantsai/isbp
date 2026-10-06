'use client';

import type { Role, RoleRequestSettings, WorkflowDefinitionSummary } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
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
import { type ReactNode, useCallback, useId } from 'react';
import { UserPicker } from '@/components/pickers/user-picker';
import { useApiQuery } from '@/lib/api';
import { Segmented } from './segmented';

/* ───────────────────────── badges ───────────────────────── */

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const RISK_ICON = { low: ShieldCheckIcon, medium: ShieldAlertIcon, high: TriangleAlertIcon } as const;
const RISK_VARIANT = { low: 'success', medium: 'warning', high: 'destructive' } as const;

/** Risk level — icon + text, never colour alone. */
export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const t = useTranslations('roles.requestSettings.riskLevels');
  const Icon = RISK_ICON[level];
  return (
    <Badge variant={RISK_VARIANT[level]} className={className}>
      <Icon aria-hidden />
      {t(level)}
    </Badge>
  );
}

export function RequestableBadge({ className }: { className?: string }) {
  const t = useTranslations('roles.requestSettings.badges');
  return (
    <Badge variant="info" className={className}>
      <HandIcon aria-hidden />
      {t('requestable')}
    </Badge>
  );
}

/** "30 days" / "1 year" style duration. */
export function useDurationText() {
  const t = useTranslations('roles.requestSettings');
  return useCallback(
    (days: number) => (days % 365 === 0 ? t('years', { count: days / 365 }) : t('days', { count: days })),
    [t],
  );
}

export function MaxDurationBadge({ days, className }: { days: number; className?: string }) {
  const t = useTranslations('roles.requestSettings.badges');
  const duration = useDurationText();
  return (
    <Badge variant="outline" className={cn('font-normal text-muted-foreground', className)}>
      <HourglassIcon aria-hidden />
      {t('maxDuration', { duration: duration(days) })}
    </Badge>
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

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <Switch
          id={`${id}-requestable`}
          checked={value.requestable}
          onCheckedChange={(v) => set({ requestable: v })}
          disabled={disabled}
          aria-describedby={`${id}-requestable-hint`}
          className="mt-0.5"
        />
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={`${id}-requestable`} className="font-medium">
            {t('requestable')}
          </Label>
          <p id={`${id}-requestable-hint`} className="text-xs text-muted-foreground">
            {value.requestable ? t('requestableHint') : t('notRequestableHint')}
          </p>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {value.requestable && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-5 px-0.5 pb-0.5">
              <div className="grid gap-2" role="group" aria-labelledby={`${id}-risk`}>
                <span id={`${id}-risk`} className="text-sm font-medium">
                  {t('risk')}
                </span>
                <Segmented
                  label={t('risk')}
                  value={value.riskLevel}
                  onChange={(v) => set({ riskLevel: v })}
                  disabled={disabled}
                  options={RISK_LEVELS.map((r) => {
                    const Icon = RISK_ICON[r];
                    return { value: r, label: t(`riskShort.${r}`), icon: <Icon aria-hidden /> };
                  })}
                />
                <p className="text-xs text-muted-foreground">{t('riskHint')}</p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`${id}-owner`}>{t('owner')}</Label>
                <UserPicker
                  id={`${id}-owner`}
                  value={value.owner}
                  onChange={(u) => set({ owner: u ? { id: u.id, displayName: u.displayName } : null })}
                  placeholder={t('ownerPlaceholder')}
                />
                <p className="text-xs text-muted-foreground">{t('ownerHint')}</p>
              </div>

              <div className="grid gap-2" role="group" aria-labelledby={`${id}-duration`}>
                <span id={`${id}-duration`} className="text-sm font-medium">
                  {t('maxDuration')}
                </span>
                <Segmented
                  label={t('maxDuration')}
                  value={value.duration}
                  onChange={(v) => set({ duration: v })}
                  disabled={disabled}
                  options={DURATIONS.map((d) => ({ value: d, label: t(`duration.${d}`) }))}
                  className="[&>button]:px-2"
                />
                <AnimatePresence initial={false}>
                  {value.duration === 'custom' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-0.5 pt-1 pb-0.5">
                        <Label htmlFor={`${id}-days`} className="sr-only">
                          {t('customDays')}
                        </Label>
                        <Input
                          id={`${id}-days`}
                          inputMode="numeric"
                          value={value.customDays}
                          onChange={(e) => set({ customDays: e.target.value.replace(/[^\d]/g, '') })}
                          disabled={disabled}
                          aria-invalid={durationInvalid || undefined}
                          aria-describedby={durationInvalid ? `${id}-days-error` : undefined}
                          className="w-28 tabular-nums"
                          placeholder="60"
                        />
                        <span className="text-sm text-muted-foreground">{t('daysUnit')}</span>
                      </div>
                      {durationInvalid && (
                        <p id={`${id}-days-error`} className="px-0.5 text-xs text-destructive">
                          {t('daysInvalid')}
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-xs text-muted-foreground">{t('maxDurationHint')}</p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`${id}-workflow`}>{t('workflow')}</Label>
                <Select
                  value={current?.id ?? DEFAULT_WORKFLOW}
                  onValueChange={(v) => {
                    if (v === DEFAULT_WORKFLOW) return set({ requestWorkflow: null });
                    const w = [...workflows.items, ...extra].find((x) => x.id === v);
                    if (w) set({ requestWorkflow: { id: w.id, name: w.name } });
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${id}-workflow`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={DEFAULT_WORKFLOW}>
                      {defaultWorkflow
                        ? t('workflowDefaultNamed', { name: workflowName(defaultWorkflow.name) })
                        : t('workflowDefault')}
                    </SelectItem>
                    {listed.length + extra.length > 0 && <SelectSeparator />}
                    {[...listed, ...extra].map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {workflowName(w.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('workflowHint')}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <HandIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('notRequestableHint')}
      </p>
    );
  }
  const rows: [string, ReactNode][] = [
    [t('requestableShort'), <RequestableBadge key="r" />],
    [t('risk'), <RiskBadge key="k" level={role.riskLevel} />],
    [
      t('owner'),
      role.owner ? (
        <span key="o" className="flex min-w-0 items-center gap-2">
          <UserAvatar name={role.owner.displayName} className="size-5 text-[9px]" />
          <span className="truncate">{role.owner.displayName}</span>
        </span>
      ) : (
        <span key="o" className="text-muted-foreground">
          {t('noOwner')}
        </span>
      ),
    ],
    [
      t('maxDuration'),
      role.maxDurationDays === null ? (
        <span key="d" className="text-muted-foreground">
          {t('duration.none')}
        </span>
      ) : (
        <span key="d">{duration(role.maxDurationDays)}</span>
      ),
    ],
    [
      t('workflow'),
      <span key="w" className="flex min-w-0 items-center gap-1.5">
        <WorkflowIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">
          {role.requestWorkflow ? workflowName(role.requestWorkflow.name) : t('workflowDefault')}
        </span>
      </span>,
    ],
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([label, node]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0">{node}</dd>
        </div>
      ))}
    </dl>
  );
}
