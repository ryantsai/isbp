'use client';

import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError, Slot, usePlatform, useSlot } from '@isbp/sdk/web';
import { Card, CardContent } from '@isbp/ui/card';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { toast } from '@isbp/ui/toast';
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
import { type Errors, errorStatus, scoped, Section } from './fields';
import { HTTP_DEFAULTS, HttpEditor } from './http-editor';
import { JsonConfigEditor } from './json-editor';
import { RunnerNotice, ScriptEditor, scriptDefaults } from './script-editor';
import { normalizeSql, SQL_DEFAULTS, SqlEditor } from './sql-editor';
import { TriggerEditor, type TriggerState } from './trigger-editor';

const NONE = '__none__';
/** Server paths of the fields under "Advanced settings" (opened when one of them has an error). */
const ADVANCED_FIELDS = ['timeoutSeconds', 'retries', 'concurrency', 'alerts.autoDisableAfter'];
const DEFAULT_TIMEOUT = 3_600;

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
  const ownerId = useId();

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
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | null>(job?.timeoutSeconds ?? DEFAULT_TIMEOUT);
  const [maxAttempts, setMaxAttempts] = useState<number | null>(
    job?.retries.maxAttempts ?? DEFAULT_RETRIES.maxAttempts,
  );
  const [backoff, setBackoff] = useState<'fixed' | 'exponential'>(
    job?.retries.backoff ?? DEFAULT_RETRIES.backoff,
  );
  const [delaySeconds, setDelaySeconds] = useState<number | null>(
    job?.retries.delaySeconds ?? DEFAULT_RETRIES.delaySeconds,
  );
  const [concurrency, setConcurrency] = useState<'skip' | 'queue'>(job?.concurrency ?? 'skip');
  const [onFailure, setOnFailure] = useState(job?.alerts.onFailure ?? DEFAULT_ALERTS.onFailure);
  const [channels, setChannels] = useState(job?.alerts.channels ?? DEFAULT_ALERTS.channels);
  const [autoDisable, setAutoDisable] = useState<number | null>(
    job?.alerts.autoDisableAfter ?? DEFAULT_ALERTS.autoDisableAfter,
  );
  const [errors, setErrors] = useState<Errors>({});
  const advancedFilled = countFilled(
    Number(timeoutSeconds) !== DEFAULT_TIMEOUT,
    Number(maxAttempts) !== DEFAULT_RETRIES.maxAttempts,
    backoff !== DEFAULT_RETRIES.backoff,
    Number(delaySeconds) !== DEFAULT_RETRIES.delaySeconds,
    concurrency !== 'skip',
    Number(autoDisable) !== DEFAULT_ALERTS.autoDisableAfter,
  );

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
    <form onSubmit={submit} noValidate>
      {/* Most fields are required (or have a default): only the optional ones are marked. */}
      <FormLayout defaultOptionality="required">
        <Section title={t('form.basics')}>
          <Grid columns={{ minWidth: 240, repeat: 'fit' }} gap={4} align="end">
            <TextInput
              label={t('fields.name')}
              value={name}
              onChange={setName}
              status={errorStatus(errors.name)}
            />
            <Field
              label={t('fields.owner')}
              inputID={ownerId}
              isOptional
              status={errorStatus(errors.ownerId)}
            >
              <PersonPicker
                id={ownerId}
                value={owner}
                onChange={setOwner}
                placeholder={t('form.pickOwner')}
                invalid={Boolean(errors.ownerId)}
              />
            </Field>
            <Selector
              label={t('fields.ownerGroup')}
              isOptional
              width="100%"
              hasSearch={groups.length > 8}
              value={ownerGroupId ?? NONE}
              onChange={(v) => setOwnerGroupId(v === NONE ? null : v)}
              options={[
                { value: NONE, label: t('form.noGroup') },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
              status={errorStatus(errors.ownerGroupId)}
            />
          </Grid>
          <TextArea
            label={t('fields.description')}
            description={t('form.descriptionHint')}
            isOptional
            rows={3}
            maxLength={5_000}
            value={description}
            onChange={setDescription}
            status={errorStatus(errors.description)}
          />
        </Section>

        <Section title={t('form.task')} description={t('form.taskHint')}>
          {job ? (
            <HStack gap={2} vAlign="center">
              <TaskIcon icon={typeInfo?.icon ?? job.task.icon} color="accent" />
              <Text weight="medium">{typeName(typeInfo?.name ?? job.task.name, type)}</Text>
              <Text color="secondary">· {t('form.typePermanent')}</Text>
            </HStack>
          ) : (
            <Selector
              label={t('fields.taskType')}
              description={typeInfo?.description ? typeName(typeInfo.description, '') : undefined}
              width={320}
              value={type}
              onChange={changeType}
              options={types.map((ty) => ({
                value: ty.type,
                label: typeName(ty.name, ty.type),
                icon: <TaskIcon icon={ty.icon} />,
              }))}
              status={errorStatus(errors.type)}
            />
          )}
          {errors.config && <FieldStatus type="error" message={errors.config} variant="detached" />}
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
          <Switch
            label={t('form.onFailure')}
            description={t('form.onFailureHint')}
            labelPosition="start"
            labelSpacing="spread"
            value={onFailure}
            onChange={setOnFailure}
          />
          <Switch
            label={t('form.channels')}
            description={t('form.channelsHint')}
            labelPosition="start"
            labelSpacing="spread"
            value={channels}
            onChange={setChannels}
          />
        </Section>

        <OptionalFields
          label={t('form.advanced')}
          filled={advancedFilled}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <VStack gap={4}>
            <Text color="secondary">{t('form.advancedHint')}</Text>
            <Section title={t('form.execution')}>
              <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4} align="end">
                <NumberInput
                  label={t('fields.timeout')}
                  description={t('form.timeoutHint')}
                  width="100%"
                  min={1}
                  value={timeoutSeconds}
                  onChange={setTimeoutSeconds}
                  status={errorStatus(errors.timeoutSeconds)}
                />
                <NumberInput
                  label={t('form.maxAttempts')}
                  description={t('form.maxAttemptsHint')}
                  width="100%"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={setMaxAttempts}
                  status={errorStatus(errors['retries.maxAttempts'])}
                />
                <Selector
                  label={t('form.backoff')}
                  description={t(`form.backoffHint.${backoff}`)}
                  width="100%"
                  value={backoff}
                  onChange={(v) => setBackoff(v as 'fixed' | 'exponential')}
                  options={[
                    { value: 'fixed', label: t('form.backoffs.fixed') },
                    { value: 'exponential', label: t('form.backoffs.exponential') },
                  ]}
                />
                <NumberInput
                  label={t('form.retryDelay')}
                  description={t('form.retryDelayHint')}
                  width="100%"
                  min={1}
                  max={3600}
                  value={delaySeconds}
                  onChange={setDelaySeconds}
                  status={errorStatus(errors['retries.delaySeconds'])}
                />
              </Grid>
              <Selector
                label={t('fields.concurrency')}
                description={t(`form.concurrencyHint.${concurrency}`)}
                width={320}
                value={concurrency}
                onChange={(v) => setConcurrency(v as 'skip' | 'queue')}
                options={CONCURRENCY_POLICIES.map((c) => ({ value: c, label: t(`concurrency.${c}`) }))}
              />
            </Section>
            <NumberInput
              label={t('form.autoDisable')}
              description={t('form.autoDisableHint')}
              width={240}
              min={0}
              max={100}
              value={autoDisable}
              onChange={setAutoDisable}
              status={errorStatus(errors['alerts.autoDisableAfter'])}
            />
          </VStack>
        </OptionalFields>

        <Section title={t('form.state')}>
          <Switch
            label={t('form.enabled')}
            description={scriptBlocked ? undefined : t('form.enabledHint')}
            labelPosition="start"
            labelSpacing="spread"
            value={enabled && !scriptBlocked}
            onChange={setEnabled}
            isDisabled={scriptBlocked}
          />
          {scriptBlocked && <RunnerNotice sandbox={sandbox} />}
        </Section>

        {!job && periodBased && (
          <Card>
            <CardContent>
              <CheckboxInput
                label={t('form.runFirst')}
                description={t('form.runFirstHint')}
                value={runFirst}
                onChange={setRunFirst}
              />
            </CardContent>
          </Card>
        )}

        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button
            label={tc('cancel')}
            variant="secondary"
            onClick={() => router.push(job ? jobHref(job.id) : '/scheduler/jobs')}
          />
          <Button
            label={job ? tc('saveChanges') : t('form.create')}
            variant="primary"
            isLoading={save.isPending || firstRun.isPending}
            type="submit"
          />
        </HStack>
      </FormLayout>
    </form>
  );
}
