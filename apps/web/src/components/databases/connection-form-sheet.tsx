'use client';

import {
  type CreateDbConnectionInput,
  DEFAULT_DB_PORTS,
  type DbEngineValue,
  type DbPurposeValue,
  type DbTestResult,
  type UpdateDbConnectionInput,
} from '@isbp/contracts';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { PlugZapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useApiMutation, useErrorText } from '@/lib/api';
import { type DbConnection, TestResultNote } from './parts';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';

const ENGINES: DbEngineValue[] = ['mssql', 'postgres', 'mysql', 'oracle'];
const KEY_RE = /^[a-z][a-z0-9-]{1,63}$/;
const HOST_RE = /^[A-Za-z0-9.:[\]_-]{1,255}$/;
export const DB_INVALIDATE = ['/databases', '/audit-logs'];

interface Draft {
  name: string;
  key: string;
  keyTouched: boolean;
  description: string;
  engine: DbEngineValue;
  host: string;
  port: string;
  database: string;
  instanceName: string;
  tls: 'off' | 'require' | 'verify';
  ca: string;
  username: string;
  password: string;
  clearPassword: boolean;
  domain: string;
  purposes: DbPurposeValue[];
  readOnly: boolean;
  enabled: boolean;
  poolMax: string;
  timeoutSec: string;
  maxRows: string;
}

function draftOf(c?: DbConnection): Draft {
  return {
    name: c?.name ?? '',
    key: c?.key ?? '',
    keyTouched: Boolean(c),
    description: c?.description ?? '',
    engine: c?.engine ?? 'mssql',
    host: c?.host ?? '',
    port: c?.port ? String(c.port) : '',
    database: c?.database ?? '',
    instanceName: c?.options.instanceName ?? '',
    tls: c?.options.tls ?? 'require',
    ca: '',
    username: c?.username ?? '',
    password: '',
    clearPassword: false,
    domain: c?.options.domain ?? '',
    purposes: c?.purposes ?? ['data'],
    readOnly: c?.readOnly ?? false,
    enabled: c?.enabled ?? true,
    poolMax: String(c?.poolMax ?? 5),
    timeoutSec: String(Math.round((c?.timeoutMs ?? 30_000) / 1000)),
    maxRows: String(c?.maxRows ?? 10_000),
  };
}

const NEW_DRAFT = draftOf();

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64);

const intIn = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** A named group of fields: a caption over a stack of fields. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <VStack gap={4} role="group" aria-labelledby={id}>
      <Text type="label" id={id}>
        {title}
      </Text>
      {children}
    </VStack>
  );
}

/** Add or edit a database connection; "Test connection" tries the settings before saving. */
export function ConnectionFormSheet({
  open,
  onOpenChange,
  connection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: DbConnection;
}) {
  const t = useTranslations('databases.form');
  const td = useTranslations('databases');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const list = useFieldList();
  const editing = Boolean(connection);
  const [draft, setDraft] = useState<Draft>(() => draftOf(connection));
  const [submitted, setSubmitted] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DbTestResult | null>(null);

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setDraft(draftOf(connection));
    setSubmitted(false);
    setAdvanced(false);
    setRootError(null);
    setTestResult(null);
  }, [open, connection]);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setTestResult(null);
  };

  const port = draft.port.trim() ? intIn(draft.port, 1, 65_535) : null;
  const errors = {
    name: !draft.name.trim() ? t('validation.name') : null,
    key: !editing && !KEY_RE.test(draft.key) ? t('validation.key') : null,
    host: !HOST_RE.test(draft.host.trim()) ? t('validation.host') : null,
    port: draft.port.trim() && port === null ? t('validation.port') : null,
    username: !draft.username.trim() ? t('validation.username') : null,
    purposes: draft.purposes.length === 0 ? t('purposesError') : null,
    poolMax: intIn(draft.poolMax, 1, 50) === null ? t('validation.number', { min: 1, max: 50 }) : null,
    timeoutSec:
      intIn(draft.timeoutSec, 1, 600) === null ? t('validation.number', { min: 1, max: 600 }) : null,
    maxRows:
      intIn(draft.maxRows, 1, 100_000) === null ? t('validation.number', { min: 1, max: 100_000 }) : null,
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const serverFields = () => ({
    engine: draft.engine,
    host: draft.host.trim(),
    port,
    database: draft.database.trim() || null,
    username: draft.username.trim(),
    options: {
      tls: draft.tls,
      ca: draft.ca.trim() || null,
      instanceName: draft.engine === 'mssql' ? draft.instanceName.trim() || null : null,
      domain: draft.engine === 'mssql' ? draft.domain.trim() || null : null,
    },
    purposes: draft.purposes,
    readOnly: draft.readOnly,
    enabled: draft.enabled,
    poolMax: intIn(draft.poolMax, 1, 50) ?? 5,
    timeoutMs: (intIn(draft.timeoutSec, 1, 600) ?? 30) * 1000,
    maxRows: intIn(draft.maxRows, 1, 100_000) ?? 10_000,
  });

  const create = useApiMutation(
    (api, body: CreateDbConnectionInput) => api.post<DbConnection>('/databases', body),
    {
      invalidate: DB_INVALIDATE,
      success: t('created'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const update = useApiMutation(
    (api, body: UpdateDbConnectionInput) => api.patch<DbConnection>(`/databases/${connection!.id}`, body),
    { invalidate: DB_INVALIDATE, success: t('saved'), onSuccess: () => onOpenChange(false), silent: true },
  );
  const test = useApiMutation((api, body: unknown) => api.post<DbTestResult>('/databases/test', body), {
    onSuccess: (r) => setTestResult(r),
    silent: true,
  });

  const runTest = () => {
    setSubmitted(true);
    setRootError(null);
    if (errors.host || errors.username || errors.port) return;
    const { purposes: _p, readOnly: _r, enabled: _e, ...fields } = serverFields();
    test.mutate(
      {
        ...fields,
        purposes: draft.purposes.length ? draft.purposes : ['data'],
        ...(editing ? { id: connection!.id } : {}),
        ...(draft.password || !editing || draft.clearPassword
          ? { password: draft.clearPassword ? null : draft.password || null }
          : {}),
      },
      { onError: (err) => setRootError(errorText(err)) },
    );
  };

  const submit = () => {
    setSubmitted(true);
    setRootError(null);
    if (Object.values(errors).some(Boolean)) {
      if (errors.poolMax || errors.timeoutSec || errors.maxRows) setAdvanced(true);
      return;
    }
    const common = {
      ...serverFields(),
      name: draft.name.trim(),
      description: draft.description.trim() || null,
    };
    const onError = (err: unknown) => setRootError(errorText(err));
    if (editing) {
      const { ca, ...options } = common.options;
      update.mutate(
        {
          ...common,
          options: { ...options, ...(ca ? { ca } : {}) },
          ...(draft.clearPassword ? { password: null } : draft.password ? { password: draft.password } : {}),
        },
        { onError },
      );
    } else create.mutate({ ...common, key: draft.key, password: draft.password || null }, { onError });
  };

  const pending = create.isPending || update.isPending;
  const err = (message: string | null) => (message ? { type: 'error' as const, message } : undefined);
  const digits = (v: string) => v.replace(/[^0-9]/g, '');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{editing ? t('editTitle', { name: connection!.name }) : t('createTitle')}</SheetTitle>
          <SheetDescription>{editing ? t('editDescription') : t('createDescription')}</SheetDescription>
        </SheetHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SheetBody className="py-2">
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 220 }} gap={4}>
                <TextInput
                  label={t('name')}
                  isRequired
                  value={draft.name}
                  autoComplete="off"
                  placeholder={t('namePlaceholder')}
                  status={err(show('name'))}
                  onChange={(name) =>
                    set({
                      name: name.slice(0, 120),
                      ...(draft.keyTouched ? {} : { key: slugify(name) }),
                    })
                  }
                />
                <TextInput
                  label={t('key')}
                  isRequired
                  value={draft.key}
                  autoComplete="off"
                  isDisabled={editing}
                  description={t('keyHint')}
                  status={err(show('key'))}
                  onChange={(key) => set({ key: key.slice(0, 64).toLowerCase(), keyTouched: true })}
                />
              </Grid>

              <Section title={t('sectionServer')}>
                <Grid columns={{ minWidth: 160 }} gap={4}>
                  <Selector
                    label={t('engine')}
                    value={draft.engine}
                    isDisabled={editing}
                    options={ENGINES.map((e) => ({ value: e, label: td(`engines.${e}`) }))}
                    onChange={(v) => set({ engine: v as DbEngineValue, port: '' })}
                  />
                  <TextInput
                    label={t('port')}
                    value={draft.port}
                    placeholder={String(DEFAULT_DB_PORTS[draft.engine])}
                    status={err(show('port'))}
                    onChange={(v) => set({ port: digits(v) })}
                  />
                </Grid>
                <TextInput
                  label={t('host')}
                  isRequired
                  value={draft.host}
                  autoComplete="off"
                  placeholder="sql-01.corp.example"
                  description={t('hostHint')}
                  status={err(show('host'))}
                  onChange={(host) => set({ host: host.trim() })}
                />
                <Grid columns={{ minWidth: 220 }} gap={4}>
                  <TextInput
                    label={draft.engine === 'oracle' ? t('serviceName') : t('database')}
                    isRequired={draft.engine === 'oracle'}
                    value={draft.database}
                    autoComplete="off"
                    onChange={(database) => set({ database })}
                  />
                  {draft.engine === 'mssql' && (
                    <TextInput
                      label={t('instanceName')}
                      value={draft.instanceName}
                      autoComplete="off"
                      description={t('instanceHint')}
                      onChange={(instanceName) => set({ instanceName })}
                    />
                  )}
                </Grid>
              </Section>

              <Section title={t('sectionSignIn')}>
                <Grid columns={{ minWidth: 220 }} gap={4}>
                  <TextInput
                    label={t('username')}
                    isRequired
                    value={draft.username}
                    autoComplete="off"
                    status={err(show('username'))}
                    onChange={(username) => set({ username })}
                  />
                  <TextInput
                    label={t('password')}
                    type="password"
                    autoComplete="new-password"
                    value={draft.password}
                    isDisabled={draft.clearPassword}
                    placeholder={editing && connection?.hasPassword ? t('passwordStored') : undefined}
                    onChange={(password) => set({ password })}
                  />
                </Grid>
                {editing && connection?.hasPassword && (
                  <CheckboxInput
                    label={t('passwordClear')}
                    value={draft.clearPassword}
                    onChange={(clearPassword) => set({ clearPassword, password: '' })}
                  />
                )}
              </Section>

              <Section title={t('purposes')}>
                <Field
                  label={t('purposes')}
                  isLabelHidden
                  isGroupLabel
                  inputID={`${id}-purposes`}
                  status={err(show('purposes'))}
                  statusVariant="detached"
                >
                  <VStack gap={3} id={`${id}-purposes`}>
                    {(['data', 'admin'] as const).map((p) => (
                      <CheckboxInput
                        key={p}
                        label={td(`purposes.${p}`)}
                        description={td(`purposes.${p}Hint`)}
                        value={draft.purposes.includes(p)}
                        onChange={(checked) =>
                          set({
                            purposes: checked
                              ? [...new Set([...draft.purposes, p])]
                              : draft.purposes.filter((x) => x !== p),
                          })
                        }
                      />
                    ))}
                  </VStack>
                </Field>
                <Switch
                  label={t('readOnly')}
                  description={t('readOnlyHint')}
                  value={draft.readOnly}
                  onChange={(readOnly) => set({ readOnly })}
                />
                <Switch label={t('enabled')} value={draft.enabled} onChange={(enabled) => set({ enabled })} />
                <Banner status="info" title={t('leastPrivilege')} collapsible={false} />
              </Section>

              <OptionalFields
                hint={list([t('description'), t('tls'), t('ca'), t('domain')])}
                filled={countFilled(
                  draft.description,
                  draft.ca || connection?.options.hasCa,
                  draft.domain,
                  draft.tls !== NEW_DRAFT.tls,
                )}
              >
                <VStack gap={4}>
                  <TextArea
                    label={t('description')}
                    rows={2}
                    value={draft.description}
                    onChange={(description) => set({ description: description.slice(0, 2000) })}
                  />
                  <Selector
                    label={t('tls')}
                    value={draft.tls}
                    options={[
                      { value: 'off', label: t('tlsOff') },
                      { value: 'require', label: t('tlsRequire') },
                      { value: 'verify', label: t('tlsVerify') },
                    ]}
                    onChange={(v) => set({ tls: v as Draft['tls'] })}
                  />
                  {draft.tls === 'verify' && (
                    <TextArea
                      label={t('ca')}
                      rows={3}
                      value={draft.ca}
                      placeholder="-----BEGIN CERTIFICATE-----"
                      description={connection?.options.hasCa ? t('caStored') : undefined}
                      onChange={(ca) => set({ ca })}
                    />
                  )}
                  {draft.engine === 'mssql' && (
                    <TextInput
                      label={t('domain')}
                      value={draft.domain}
                      autoComplete="off"
                      description={t('domainHint')}
                      onChange={(domain) => set({ domain })}
                    />
                  )}
                </VStack>
              </OptionalFields>

              <OptionalFields
                label={t('advanced')}
                open={advanced}
                onOpenChange={setAdvanced}
                filled={countFilled(
                  draft.poolMax !== NEW_DRAFT.poolMax,
                  draft.timeoutSec !== NEW_DRAFT.timeoutSec,
                  draft.maxRows !== NEW_DRAFT.maxRows,
                )}
              >
                <Grid columns={{ minWidth: 140 }} gap={4}>
                  <TextInput
                    label={t('poolMax')}
                    value={draft.poolMax}
                    status={err(show('poolMax'))}
                    onChange={(v) => set({ poolMax: digits(v) })}
                  />
                  <TextInput
                    label={t('timeout')}
                    value={draft.timeoutSec}
                    status={err(show('timeoutSec'))}
                    onChange={(v) => set({ timeoutSec: digits(v) })}
                  />
                  <TextInput
                    label={t('maxRows')}
                    value={draft.maxRows}
                    status={err(show('maxRows'))}
                    onChange={(v) => set({ maxRows: digits(v) })}
                  />
                </Grid>
              </OptionalFields>

              <div aria-live="polite">{testResult && <TestResultNote result={testResult} />}</div>
              {rootError && <Banner status="error" title={rootError} collapsible={false} />}
            </FormLayout>
          </SheetBody>
          <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              label={t('testDraft')}
              variant="secondary"
              icon={<Icon icon={PlugZapIcon} />}
              isLoading={test.isPending}
              type="button"
              onClick={runTest}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                label={tc('cancel')}
                variant="ghost"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={editing ? tc('saveChanges') : t('submit')}
                variant="primary"
                isLoading={pending}
                type="submit"
              />
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
