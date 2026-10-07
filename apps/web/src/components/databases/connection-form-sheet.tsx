'use client';

import {
  type CreateDbConnectionInput,
  DEFAULT_DB_PORTS,
  type DbEngineValue,
  type DbPurposeValue,
  type DbTestResult,
  type UpdateDbConnectionInput,
} from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { AlertTriangleIcon, ChevronDownIcon, InfoIcon, PlugZapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useApiMutation, useErrorText } from '@/lib/api';
import { type DbConnection, TestResultNote } from './parts';

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

  const field = (
    key: string,
    label: ReactNode,
    control: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode,
    opts: { error?: string | null; hint?: ReactNode; className?: string } = {},
  ) => {
    const fid = `${id}-${key}`;
    const describedBy = [opts.error ? `${fid}-error` : null, opts.hint ? `${fid}-hint` : null]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={`grid min-w-0 gap-2 ${opts.className ?? ''}`}>
        <Label htmlFor={fid}>{label}</Label>
        {control({
          id: fid,
          ...(opts.error ? { 'aria-invalid': true as const } : {}),
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        })}
        {opts.error ? (
          <p id={`${fid}-error`} className="text-xs text-destructive">
            {opts.error}
          </p>
        ) : opts.hint ? (
          <p id={`${fid}-hint`} className="text-xs text-muted-foreground">
            {opts.hint}
          </p>
        ) : null}
      </div>
    );
  };

  const optional = <span className="font-normal text-muted-foreground">({tc('optional')})</span>;
  const pending = create.isPending || update.isPending;

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
          <SheetBody className="space-y-6 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field(
                'name',
                t('name'),
                (p) => (
                  <Input
                    {...p}
                    value={draft.name}
                    maxLength={120}
                    autoComplete="off"
                    placeholder={t('namePlaceholder')}
                    onChange={(e) =>
                      set({
                        name: e.target.value,
                        ...(draft.keyTouched ? {} : { key: slugify(e.target.value) }),
                      })
                    }
                  />
                ),
                { error: show('name') },
              )}
              {field(
                'key',
                t('key'),
                (p) => (
                  <Input
                    {...p}
                    value={draft.key}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    disabled={editing}
                    onChange={(e) => set({ key: e.target.value.toLowerCase(), keyTouched: true })}
                  />
                ),
                { error: show('key'), hint: t('keyHint') },
              )}
            </div>
            {field(
              'description',
              <>
                {t('description')} {optional}
              </>,
              (p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={2000}
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              ),
            )}

            <fieldset className="min-w-0 space-y-4">
              <legend className="mb-3 text-sm font-semibold">{t('sectionServer')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
                {field('engine', t('engine'), (p) => (
                  <Select
                    value={draft.engine}
                    onValueChange={(v) => set({ engine: v as DbEngineValue, port: '' })}
                    disabled={editing}
                  >
                    <SelectTrigger id={p.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENGINES.map((e) => (
                        <SelectItem key={e} value={e}>
                          {td(`engines.${e}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
                {field(
                  'port',
                  t('port'),
                  (p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={draft.port}
                      placeholder={String(DEFAULT_DB_PORTS[draft.engine])}
                      onChange={(e) => set({ port: e.target.value.replace(/[^0-9]/g, '') })}
                    />
                  ),
                  { error: show('port') },
                )}
              </div>
              {field(
                'host',
                t('host'),
                (p) => (
                  <Input
                    {...p}
                    value={draft.host}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    placeholder="sql-01.corp.example"
                    onChange={(e) => set({ host: e.target.value.trim() })}
                  />
                ),
                { error: show('host'), hint: t('hostHint') },
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field(
                  'database',
                  <>
                    {draft.engine === 'oracle' ? t('serviceName') : t('database')}{' '}
                    {draft.engine !== 'oracle' && optional}
                  </>,
                  (p) => (
                    <Input
                      {...p}
                      value={draft.database}
                      spellCheck={false}
                      autoComplete="off"
                      className="font-mono"
                      onChange={(e) => set({ database: e.target.value })}
                    />
                  ),
                )}
                {draft.engine === 'mssql' &&
                  field(
                    'instance',
                    <>
                      {t('instanceName')} {optional}
                    </>,
                    (p) => (
                      <Input
                        {...p}
                        value={draft.instanceName}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => set({ instanceName: e.target.value })}
                      />
                    ),
                    { hint: t('instanceHint') },
                  )}
              </div>
              {field('tls', t('tls'), (p) => (
                <Select value={draft.tls} onValueChange={(v) => set({ tls: v as Draft['tls'] })}>
                  <SelectTrigger id={p.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">{t('tlsOff')}</SelectItem>
                    <SelectItem value="require">{t('tlsRequire')}</SelectItem>
                    <SelectItem value="verify">{t('tlsVerify')}</SelectItem>
                  </SelectContent>
                </Select>
              ))}
              {draft.tls === 'verify' &&
                field(
                  'ca',
                  <>
                    {t('ca')} {optional}
                  </>,
                  (p) => (
                    <Textarea
                      {...p}
                      rows={3}
                      value={draft.ca}
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder="-----BEGIN CERTIFICATE-----"
                      onChange={(e) => set({ ca: e.target.value })}
                    />
                  ),
                  { hint: connection?.options.hasCa ? t('caStored') : undefined },
                )}
            </fieldset>

            <fieldset className="min-w-0 space-y-4">
              <legend className="mb-3 text-sm font-semibold">{t('sectionSignIn')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field(
                  'username',
                  t('username'),
                  (p) => (
                    <Input
                      {...p}
                      value={draft.username}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => set({ username: e.target.value })}
                    />
                  ),
                  { error: show('username') },
                )}
                {field('password', t('password'), (p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={draft.password}
                    disabled={draft.clearPassword}
                    placeholder={editing && connection?.hasPassword ? t('passwordStored') : undefined}
                    onChange={(e) => set({ password: e.target.value })}
                  />
                ))}
              </div>
              {editing && connection?.hasPassword && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-clear`}
                    checked={draft.clearPassword}
                    onCheckedChange={(v) => set({ clearPassword: v === true, password: '' })}
                  />
                  <Label htmlFor={`${id}-clear`} className="font-normal">
                    {t('passwordClear')}
                  </Label>
                </div>
              )}
              {draft.engine === 'mssql' &&
                field(
                  'domain',
                  <>
                    {t('domain')} {optional}
                  </>,
                  (p) => (
                    <Input
                      {...p}
                      value={draft.domain}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => set({ domain: e.target.value })}
                    />
                  ),
                  { hint: t('domainHint') },
                )}
            </fieldset>

            <fieldset
              className="min-w-0 space-y-3"
              aria-describedby={show('purposes') ? `${id}-purposes-error` : undefined}
            >
              <legend className="mb-3 text-sm font-semibold">{t('purposes')}</legend>
              {(['data', 'admin'] as const).map((p) => (
                <div key={p} className="flex items-start gap-3">
                  <Checkbox
                    id={`${id}-purpose-${p}`}
                    checked={draft.purposes.includes(p)}
                    aria-describedby={`${id}-purpose-${p}-hint`}
                    onCheckedChange={(v) =>
                      set({
                        purposes:
                          v === true
                            ? [...new Set([...draft.purposes, p])]
                            : draft.purposes.filter((x) => x !== p),
                      })
                    }
                  />
                  <div className="grid gap-0.5">
                    <Label htmlFor={`${id}-purpose-${p}`}>{td(`purposes.${p}`)}</Label>
                    <p id={`${id}-purpose-${p}-hint`} className="text-xs text-muted-foreground">
                      {td(`purposes.${p}Hint`)}
                    </p>
                  </div>
                </div>
              ))}
              {show('purposes') && (
                <p id={`${id}-purposes-error`} className="text-xs text-destructive">
                  {show('purposes')}
                </p>
              )}
              <div className="flex items-start justify-between gap-4 pt-2">
                <div className="grid gap-0.5">
                  <Label htmlFor={`${id}-ro`}>{t('readOnly')}</Label>
                  <p id={`${id}-ro-hint`} className="text-xs text-muted-foreground">
                    {t('readOnlyHint')}
                  </p>
                </div>
                <Switch
                  id={`${id}-ro`}
                  aria-describedby={`${id}-ro-hint`}
                  checked={draft.readOnly}
                  onCheckedChange={(v) => set({ readOnly: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor={`${id}-enabled`}>{t('enabled')}</Label>
                <Switch
                  id={`${id}-enabled`}
                  checked={draft.enabled}
                  onCheckedChange={(v) => set({ enabled: v })}
                />
              </div>
              <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                {t('leastPrivilege')}
              </p>
            </fieldset>

            <div>
              <button
                type="button"
                onClick={() => setAdvanced((a) => !a)}
                aria-expanded={advanced}
                aria-controls={`${id}-limits`}
                className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <ChevronDownIcon
                  className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${advanced ? 'rotate-180' : ''}`}
                  aria-hidden
                />
                {t('advanced')}
              </button>
              <div
                id={`${id}-limits`}
                hidden={!advanced}
                className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3"
              >
                {field(
                  'pool',
                  t('poolMax'),
                  (p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={draft.poolMax}
                      onChange={(e) => set({ poolMax: e.target.value.replace(/[^0-9]/g, '') })}
                    />
                  ),
                  { error: show('poolMax') },
                )}
                {field(
                  'timeout',
                  t('timeout'),
                  (p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={draft.timeoutSec}
                      onChange={(e) => set({ timeoutSec: e.target.value.replace(/[^0-9]/g, '') })}
                    />
                  ),
                  { error: show('timeoutSec') },
                )}
                {field(
                  'rows',
                  t('maxRows'),
                  (p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={draft.maxRows}
                      onChange={(e) => set({ maxRows: e.target.value.replace(/[^0-9]/g, '') })}
                    />
                  ),
                  { error: show('maxRows') },
                )}
              </div>
            </div>

            <div aria-live="polite">{testResult && <TestResultNote result={testResult} />}</div>
            {rootError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {rootError}
              </p>
            )}
          </SheetBody>
          <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={runTest} loading={test.isPending}>
              <PlugZapIcon /> {t('testDraft')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {editing ? tc('saveChanges') : t('submit')}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
