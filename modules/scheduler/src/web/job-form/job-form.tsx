'use client';

import { ApiError, Slot, usePlatform, useSlot } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Disclosure } from '@isbp/ui/motion';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { toast } from '@isbp/ui/sonner';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import {
  BUILTIN_TYPES,
  CONCURRENCY_POLICIES,
  type CreateJobInput,
  cronForPeriod,
  DEFAULT_ALERTS,
  DEFAULT_RETRIES,
  type JobDetail,
  type SandboxStatus,
  type TaskConfigSlotProps,
  type TaskType,
} from '../../contracts';
import { TaskIcon } from '../badges';
import { INVALIDATE, jobHref, localTimeZone, useGroups, useTypeName } from '../lib';
import { type Errors, FormRow, NumberInput, scoped, Section } from './fields';
import { HTTP_DEFAULTS, HttpEditor } from './http-editor';
import { JsonConfigEditor } from './json-editor';
import { RunnerNotice, ScriptEditor, scriptDefaults } from './script-editor';
import { normalizeSql, SQL_DEFAULTS, SqlEditor } from './sql-editor';
import { TriggerEditor, type TriggerState } from './trigger-editor';

const NONE = '__none__';
/** Server paths of the fields under "Advanced settings" (opened when one of them has an error). */
const ADVANCED_FIELDS = ['timeoutSeconds', 'retries', 'concurrency', 'alerts.autoDisableAfter'];

export interface JobFormInitial {
  type?: string;
  name?: string;
  config?: Record<string, unknown>;
}

function defaultsFor(type: string, sandbox: SandboxStatus): Record<string, unknown> {
  if (type === BUILTIN_TYPES.http) return { ...HTTP_DEFAULTS };
  if (type === BUILTIN_TYPES.sql) return { ...SQL_DEFAULTS };
  if (type === BUILTIN_TYPES.script) return scriptDefaults(sandbox);
  return {};
}

/** The config editor of a module task type: its contributed slot, or the JSON editor. */
function ModuleConfig({
  type,
  value,
  onChange,
  errors,
  schema,
}: {
  type: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  errors: Errors;
  schema: unknown;
}) {
  const name = `scheduler.task-config.${type}`;
  const contributions = useSlot(name);
  if (contributions.length)
    return <Slot name={name} props={{ type, value, onChange, errors } satisfies TaskConfigSlotProps} />;
  return <JsonConfigEditor key={type} value={value} onChange={onChange} errors={errors} schema={schema} />;
}

/**
 * Create or edit a job: basics, the task (built-in editors, a module's slot, or JSON), the trigger with a
 * live preview, execution (timeout, retries, concurrency), alerts and the enabled switch. Server field
 * errors land next to their fields.
 */
export function JobForm({
  job,
  initial,
  types,
  sandbox,
}: {
  job?: JobDetail;
  initial?: JobFormInitial;
  types: TaskType[];
  sandbox: SandboxStatus;
}) {
  const t = useTranslations('scheduler');
  const tc = useTranslations('common');
  const typeName = useTypeName();
  const errorText = useErrorText();
  const router = useRouter();
  const { user } = usePlatform();
  const groups = useGroups();

  const initialType =
    job?.type ??
    (initial?.type && types.some((x) => x.type === initial.type) ? initial.type : undefined) ??
    (types.some((x) => x.type === BUILTIN_TYPES.http)
      ? BUILTIN_TYPES.http
      : (types[0]?.type ?? BUILTIN_TYPES.http));
  const [name, setName] = useState(job?.name ?? initial?.name ?? '');
  const [description, setDescription] = useState(job?.description ?? '');
  const [owner, setOwner] = useState<PersonOption | null>(
    job ? (job.owner ?? null) : { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
  );
  const [ownerGroupId, setOwnerGroupId] = useState<string | null>(job?.ownerGroup?.id ?? null);
  const [type, setType] = useState(initialType);
  const initialConfig =
    job?.config ??
    (initial?.config && initial.type === initialType ? initial.config : defaultsFor(initialType, sandbox));
  const [config, setConfigState] = useState<Record<string, unknown>>(initialConfig);
  /** The person changed the schedule themselves: stop following the task's period. */
  const [triggerTouched, setTriggerTouched] = useState(Boolean(job));
  const [runFirst, setRunFirst] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [trigger, setTriggerState] = useState<TriggerState>({
    kind: job?.trigger.kind ?? 'cron',
    // A period-based task (a monthly checklist) starts on its period's schedule, not a generic daily one.
    cron: job?.trigger.cron ?? cronForPeriod(initialConfig.period) ?? '0 7 * * *',
    timezone: job?.trigger.kind === 'cron' ? job.trigger.timezone : localTimeZone(),
    intervalMinutes: String(job?.trigger.intervalMinutes ?? 60),
    upstream: job?.trigger.upstream ?? [],
    mode: job?.trigger.mode ?? 'all',
  });
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(job?.timeoutSeconds ?? 3_600));
  const [maxAttempts, setMaxAttempts] = useState(
    String(job?.retries.maxAttempts ?? DEFAULT_RETRIES.maxAttempts),
  );
  const [backoff, setBackoff] = useState<'fixed' | 'exponential'>(
    job?.retries.backoff ?? DEFAULT_RETRIES.backoff,
  );
  const [delaySeconds, setDelaySeconds] = useState(
    String(job?.retries.delaySeconds ?? DEFAULT_RETRIES.delaySeconds),
  );
  const [concurrency, setConcurrency] = useState<'skip' | 'queue'>(job?.concurrency ?? 'skip');
  const [onFailure, setOnFailure] = useState(job?.alerts.onFailure ?? DEFAULT_ALERTS.onFailure);
  const [channels, setChannels] = useState(job?.alerts.channels ?? DEFAULT_ALERTS.channels);
  const [autoDisable, setAutoDisable] = useState(
    String(job?.alerts.autoDisableAfter ?? DEFAULT_ALERTS.autoDisableAfter),
  );
  const [errors, setErrors] = useState<Errors>({});

  const typeInfo = types.find((x) => x.type === type);
  const scriptBlocked = type === BUILTIN_TYPES.script && sandbox.runner === 'none';
  const configErrors = scoped(errors, 'config');

  const setTrigger = (next: TriggerState) => {
    setTriggerTouched(true);
    setTriggerState(next);
  };
  const setConfig = (next: Record<string, unknown>) => {
    setConfigState(next);
    const cron = cronForPeriod(next.period);
    if (!triggerTouched && cron && next.period !== config.period)
      setTriggerState((tr) => ({ ...tr, kind: 'cron', cron }));
  };
  const periodBased = cronForPeriod(config.period) !== null;

  const changeType = (next: string) => {
    setType(next);
    setConfig(defaultsFor(next, sandbox));
    setErrors({});
  };

  const payload = (): CreateJobInput => {
    const cfg = type === BUILTIN_TYPES.sql ? normalizeSql(config) : config;
    const trig: CreateJobInput['trigger'] =
      trigger.kind === 'cron'
        ? { kind: 'cron', cron: trigger.cron.trim(), timezone: trigger.timezone }
        : trigger.kind === 'interval'
          ? { kind: 'interval', intervalMinutes: Math.floor(Number(trigger.intervalMinutes)) }
          : trigger.kind === 'after'
            ? { kind: 'after', upstreamIds: trigger.upstream.map((u) => u.id), mode: trigger.mode }
            : { kind: 'manual' };
    return {
      name: name.trim(),
      description: description.trim() || null,
      ownerId: owner?.id ?? null,
      ownerGroupId,
      type,
      config: cfg,
      trigger: trig,
      enabled: enabled && !scriptBlocked,
      timeoutSeconds: Math.floor(Number(timeoutSeconds)),
      retries: {
        maxAttempts: Math.floor(Number(maxAttempts)),
        backoff,
        delaySeconds: Math.floor(Number(delaySeconds)),
      },
      concurrency,
      alerts: { onFailure, channels, autoDisableAfter: Math.floor(Number(autoDisable) || 0) },
    };
  };

  const firstRun = useApiMutation((api, id: string) => api.post(`/scheduler/jobs/${id}/run`), {
    invalidate: INVALIDATE,
  });
  const save = useApiMutation(
    (api, body: CreateJobInput) =>
      job
        ? api.patch<JobDetail>(`/scheduler/jobs/${job.id}`, { ...body, type: undefined })
        : api.post<JobDetail>('/scheduler/jobs', body),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: job ? t('form.saved') : t('form.created'),
      onSuccess: (saved) => {
        // "Also run it now": this period's assignment opens today instead of at the next scheduled run.
        if (!job && periodBased && runFirst && saved.enabled)
          firstRun.mutate(saved.id, { onSettled: () => router.push(jobHref(saved.id)) });
        else router.push(jobHref(saved.id));
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const local: Errors = {};
    if (!name.trim()) local.name = t('form.nameRequired');
    if (trigger.kind === 'after' && !trigger.upstream.length)
      local['trigger.upstreamIds'] = t('form.upstreamRequired');
    if (trigger.kind === 'interval' && !(Number(trigger.intervalMinutes) >= 1))
      local['trigger.intervalMinutes'] = t('form.intervalInvalid');
    setErrors(local);
    if (ADVANCED_FIELDS.some((f) => local[f])) setAdvancedOpen(true);
    if (Object.keys(local).length) {
      toast.error(t('form.checkFields'));
      return;
    }
    save.mutate(payload(), {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
          const issues =
            (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
          setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
          if (issues.some((i) => ADVANCED_FIELDS.some((f) => i.path.startsWith(f)))) setAdvancedOpen(true);
          toast.error(t('form.checkFields'));
          return;
        }
        if (err instanceof ApiError && err.code === 'JOB_CYCLE') {
          const path = (err.details as { path?: { name: string }[] } | undefined)?.path ?? [];
          setErrors({
            'trigger.upstreamIds': t('form.cycle', { path: path.map((p) => p.name).join(' → ') }),
          });
          toast.error(t('form.checkFields'));
          return;
        }
        toast.error(errorText(err));
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-6">
      <Section title={t('form.basics')}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <FormRow label={t('fields.name')} error={errors.name}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                required
              />
            )}
          </FormRow>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <FormRow label={t('fields.owner')} error={errors.ownerId}>
              {({ id, describedBy, invalid }) => (
                <PersonPicker
                  id={id}
                  value={owner}
                  onChange={setOwner}
                  placeholder={t('form.pickOwner')}
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </FormRow>
            <FormRow label={t('fields.ownerGroup')} error={errors.ownerGroupId}>
              {({ id }) => (
                <Select
                  value={ownerGroupId ?? NONE}
                  onValueChange={(v) => setOwnerGroupId(v === NONE ? null : v)}
                >
                  <SelectTrigger id={id} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      <span className="text-muted-foreground">{t('form.noGroup')}</span>
                    </SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormRow>
          </div>
        </div>
        <FormRow
          label={t('fields.description')}
          hint={t('form.descriptionHint')}
          error={errors.description}
          optional
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5_000}
              aria-describedby={describedBy}
            />
          )}
        </FormRow>
      </Section>

      <Section title={t('form.task')} description={t('form.taskHint')}>
        {job ? (
          <p className="flex items-center gap-2 text-sm">
            <TaskIcon icon={typeInfo?.icon ?? job.task.icon} className="text-primary" />
            <span className="font-medium">{typeName(typeInfo?.name ?? job.task.name, type)}</span>
            <span className="text-muted-foreground">· {t('form.typePermanent')}</span>
          </p>
        ) : (
          <FormRow
            label={t('fields.taskType')}
            error={errors.type}
            hint={typeInfo?.description && typeName(typeInfo.description, '')}
          >
            {({ id, describedBy, invalid }) => (
              <Select value={type} onValueChange={changeType}>
                <SelectTrigger
                  id={id}
                  className="w-full sm:w-80"
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((ty) => (
                    <SelectItem key={ty.type} value={ty.type}>
                      <TaskIcon icon={ty.icon} />
                      {typeName(ty.name, ty.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormRow>
        )}
        {errors.config && <p className="text-xs font-medium text-destructive">{errors.config}</p>}
        {type === BUILTIN_TYPES.http ? (
          <HttpEditor value={config} onChange={setConfig} errors={configErrors} />
        ) : type === BUILTIN_TYPES.sql ? (
          <SqlEditor value={config} onChange={setConfig} errors={configErrors} />
        ) : type === BUILTIN_TYPES.script ? (
          <ScriptEditor value={config} onChange={setConfig} errors={configErrors} sandbox={sandbox} />
        ) : (
          <ModuleConfig
            type={type}
            value={config}
            onChange={setConfig}
            errors={configErrors}
            schema={typeInfo?.configSchema}
          />
        )}
      </Section>

      <Section title={t('form.trigger')} description={t('form.triggerHint')}>
        <TriggerEditor value={trigger} onChange={setTrigger} errors={errors} jobId={job?.id} />
      </Section>

      <Section title={t('form.alerts')} description={t('form.alertsHint')}>
        <div className="grid min-w-0 gap-4">
          <SwitchRow
            label={t('form.onFailure')}
            hint={t('form.onFailureHint')}
            checked={onFailure}
            onChange={setOnFailure}
          />
          <SwitchRow
            label={t('form.channels')}
            hint={t('form.channelsHint')}
            checked={channels}
            onChange={setChannels}
          />
        </div>
      </Section>

      <Disclosure
        summary={t('form.advanced')}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="min-w-0 rounded-xl border bg-card px-4 shadow-xs sm:px-6"
        triggerClassName="py-4 font-semibold"
      >
        <p className="-mt-2 pb-4 text-sm text-muted-foreground">{t('form.advancedHint')}</p>
        <div className="grid min-w-0 gap-6 pb-6">
          <Section title={t('form.execution')}>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormRow label={t('fields.timeout')} hint={t('form.timeoutHint')} error={errors.timeoutSeconds}>
                {({ id, describedBy, invalid }) => (
                  <NumberInput
                    id={id}
                    value={timeoutSeconds}
                    onChange={setTimeoutSeconds}
                    min={1}
                    describedBy={describedBy}
                    invalid={invalid}
                    className="sm:w-full"
                  />
                )}
              </FormRow>
              <FormRow
                label={t('form.maxAttempts')}
                hint={t('form.maxAttemptsHint')}
                error={errors['retries.maxAttempts']}
              >
                {({ id, describedBy, invalid }) => (
                  <NumberInput
                    id={id}
                    value={maxAttempts}
                    onChange={setMaxAttempts}
                    min={1}
                    max={10}
                    describedBy={describedBy}
                    invalid={invalid}
                    className="sm:w-full"
                  />
                )}
              </FormRow>
              <FormRow label={t('form.backoff')} hint={t(`form.backoffHint.${backoff}`)}>
                {({ id, describedBy }) => (
                  <Select value={backoff} onValueChange={(v) => setBackoff(v as 'fixed' | 'exponential')}>
                    <SelectTrigger id={id} className="w-full" aria-describedby={describedBy}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">{t('form.backoffs.fixed')}</SelectItem>
                      <SelectItem value="exponential">{t('form.backoffs.exponential')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormRow>
              <FormRow
                label={t('form.retryDelay')}
                hint={t('form.retryDelayHint')}
                error={errors['retries.delaySeconds']}
              >
                {({ id, describedBy, invalid }) => (
                  <NumberInput
                    id={id}
                    value={delaySeconds}
                    onChange={setDelaySeconds}
                    min={1}
                    max={3600}
                    describedBy={describedBy}
                    invalid={invalid}
                    className="sm:w-full"
                  />
                )}
              </FormRow>
            </div>
            <FormRow label={t('fields.concurrency')} hint={t(`form.concurrencyHint.${concurrency}`)}>
              {({ id, describedBy }) => (
                <Select value={concurrency} onValueChange={(v) => setConcurrency(v as 'skip' | 'queue')}>
                  <SelectTrigger id={id} className="w-full sm:w-80" aria-describedby={describedBy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONCURRENCY_POLICIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`concurrency.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormRow>
          </Section>
          <div className="grid min-w-0 gap-4">
            <FormRow
              label={t('form.autoDisable')}
              hint={t('form.autoDisableHint')}
              error={errors['alerts.autoDisableAfter']}
            >
              {({ id, describedBy, invalid }) => (
                <NumberInput
                  id={id}
                  value={autoDisable}
                  onChange={setAutoDisable}
                  min={0}
                  max={100}
                  describedBy={describedBy}
                  invalid={invalid}
                />
              )}
            </FormRow>
          </div>
        </div>
      </Disclosure>

      <Section title={t('form.state')}>
        <SwitchRow
          label={t('form.enabled')}
          hint={scriptBlocked ? undefined : t('form.enabledHint')}
          checked={enabled && !scriptBlocked}
          onChange={setEnabled}
          disabled={scriptBlocked}
        />
        {scriptBlocked && <RunnerNotice sandbox={sandbox} />}
      </Section>

      {!job && periodBased && (
        <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs sm:px-6">
          <Checkbox
            id="job-run-first"
            checked={runFirst}
            onCheckedChange={(v) => setRunFirst(v === true)}
            aria-describedby="job-run-first-hint"
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor="job-run-first">{t('form.runFirst')}</Label>
            <p id="job-run-first-hint" className="text-xs text-muted-foreground">
              {t('form.runFirstHint')}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(job ? jobHref(job.id) : '/scheduler/jobs')}
        >
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending || firstRun.isPending}>
          {job ? tc('saveChanges') : t('form.create')}
        </Button>
      </div>
    </form>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  );
}
