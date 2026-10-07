'use client';

import { Slot, useSlot } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { CircleCheckIcon, CircleXIcon, LockOpenIcon, PlugZapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  Connection,
  ConnectionCreated,
  ConnectorConfigSlotProps,
  ConnectorInfoDto,
  TestResult,
} from '../../contracts';
import { ModuleIcon } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, issuesOf } from '../lib';
import { GeneratedConnectorForm } from './generated-form';

interface Draft {
  name: string;
  enabled: boolean;
  allowInsecureHttp: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  removed: string[];
}

const draftOf = (c?: Connection): Draft => ({
  name: c?.name ?? '',
  enabled: c?.enabled ?? true,
  allowInsecureHttp: c?.allowInsecureHttp ?? false,
  config: { ...(c?.config ?? {}) },
  secrets: {},
  removed: [],
});

/** A test's outcome, announced politely; an `INSECURE_HTTP` failure points at the switch. */
export function TestResultNote({ result }: { result: TestResult }) {
  const t = useTranslations('integrations.connectionForm');
  const te = useTranslations('errors');
  if (result.ok)
    return (
      <p className="flex items-start gap-2 text-sm text-success">
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {result.account ? t('testOkAccount', { account: result.account }) : t('testOk')}
          {result.message && <span className="block text-muted-foreground">{result.message}</span>}
        </span>
      </p>
    );
  return (
    <div className="grid gap-1 text-sm">
      <p className="flex items-start gap-2 text-destructive">
        <CircleXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="wrap-anywhere">
          {result.code && te.has(result.code) ? te(result.code) : t('testFailed')}
          {result.message && <span className="block text-muted-foreground">{result.message}</span>}
        </span>
      </p>
      {result.code === 'INSECURE_HTTP' && (
        <p className="flex items-start gap-2 pl-6 text-xs text-muted-foreground">
          <LockOpenIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('insecureHint')}
        </p>
      )}
    </div>
  );
}

/**
 * Add or edit a connection. The connector's own settings form comes from its slot
 * (`integrations.connector-config.<type>`), or is generated from its schemas; the hub adds the name, the
 * enabled switch and the "Security" fieldset ("Allow insecure HTTP", confirmed and audited). "Test" tries
 * the settings before saving.
 */
export function ConnectionSheet({
  open,
  onOpenChange,
  connector,
  connection,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: ConnectorInfoDto | null;
  connection?: Connection;
  onCreated?: (c: ConnectionCreated) => void;
}) {
  const t = useTranslations('integrations.connectionForm');
  const ts = useTranslations('integrations.security');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const editing = Boolean(connection);
  const type = connection?.type ?? connector?.type ?? '';
  const contributed = useSlot(`integrations.connector-config.${type}`).length > 0;
  const [draft, setDraft] = useState<Draft>(() => draftOf(connection));
  const [submitted, setSubmitted] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [confirmInsecure, setConfirmInsecure] = useState(false);

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setDraft(draftOf(connection));
    setSubmitted(false);
    setRootError(null);
    setFieldErrors({});
    setResult(null);
  }, [open, connection]);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setResult(null);
  };

  const nameError = submitted && !draft.name.trim() ? t('nameRequired') : null;
  const onError = (err: unknown) => {
    const issues = issuesOf(err);
    setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
    setRootError(errorText(err));
  };

  const create = useApiMutation(
    (api, body: unknown) => api.post<ConnectionCreated>('/integrations/connections', body),
    {
      invalidate: INVALIDATE,
      success: t('created'),
      silent: true,
      onSuccess: (c) => {
        onOpenChange(false);
        onCreated?.(c);
      },
    },
  );
  const update = useApiMutation(
    (api, body: unknown) => api.patch<Connection>(`/integrations/connections/${connection!.id}`, body),
    { invalidate: INVALIDATE, success: t('saved'), silent: true, onSuccess: () => onOpenChange(false) },
  );
  const test = useApiMutation(
    (api, body: unknown) => api.post<TestResult>('/integrations/connections/test', body),
    {
      silent: true,
      onSuccess: (r) => setResult(r),
    },
  );

  const secretsToSend = () =>
    Object.fromEntries(Object.entries(draft.secrets).filter(([, v]) => v.trim() !== ''));

  const runTest = () => {
    setRootError(null);
    setFieldErrors({});
    setResult(null);
    test.mutate(
      {
        ...(connection ? { id: connection.id } : {}),
        type,
        config: draft.config,
        secrets: secretsToSend(),
        removeSecrets: draft.removed,
        allowInsecureHttp: draft.allowInsecureHttp,
      },
      { onError },
    );
  };

  const submit = () => {
    setSubmitted(true);
    setRootError(null);
    setFieldErrors({});
    if (!draft.name.trim()) return;
    if (editing)
      update.mutate(
        {
          name: draft.name.trim(),
          enabled: draft.enabled,
          allowInsecureHttp: draft.allowInsecureHttp,
          config: draft.config,
          secrets: secretsToSend(),
          ...(draft.removed.length ? { removeSecrets: draft.removed } : {}),
        },
        { onError },
      );
    else
      create.mutate(
        {
          name: draft.name.trim(),
          type,
          enabled: draft.enabled,
          allowInsecureHttp: draft.allowInsecureHttp,
          config: draft.config,
          secrets: secretsToSend(),
        },
        { onError },
      );
  };

  const slotProps: ConnectorConfigSlotProps = {
    type,
    config: draft.config,
    onConfigChange: (config) => set({ config }),
    secrets: draft.secrets,
    onSecretsChange: (secrets) => set({ secrets }),
    storedSecrets: (connection?.storedSecrets ?? []).filter((k) => !draft.removed.includes(k)),
    errors: fieldErrors,
    disabled: create.isPending || update.isPending,
    editing,
  };
  const pending = create.isPending || update.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ModuleIcon name={connector?.icon} className="size-4 text-primary" />
            {editing
              ? t('editTitle', { name: connection!.name })
              : t('createTitle', { connector: connector?.name ?? type })}
          </SheetTitle>
          <SheetDescription>{connector?.description ?? t('description')}</SheetDescription>
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
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-name`}>{t('name')}</Label>
              <Input
                id={`${id}-name`}
                value={draft.name}
                maxLength={120}
                autoComplete="off"
                placeholder={t('namePlaceholder')}
                aria-invalid={nameError || fieldErrors.name ? true : undefined}
                aria-describedby={nameError ? `${id}-name-error` : `${id}-name-hint`}
                onChange={(e) => set({ name: e.target.value })}
              />
              {nameError ? (
                <p id={`${id}-name-error`} className="text-xs text-destructive">
                  {nameError}
                </p>
              ) : (
                <p id={`${id}-name-hint`} className="text-xs text-muted-foreground">
                  {t('nameHint')}
                </p>
              )}
            </div>

            <section aria-labelledby={`${id}-settings`} className="grid min-w-0 gap-4">
              <h3 id={`${id}-settings`} className="text-sm font-semibold">
                {t('settings')}
              </h3>
              {contributed ? (
                <Slot
                  name={`integrations.connector-config.${type}`}
                  props={slotProps}
                  fallback={<Skeleton className="h-40 w-full" />}
                />
              ) : connector ? (
                <GeneratedConnectorForm
                  configSchema={connector.configSchema}
                  secretsSchema={connector.secretsSchema}
                  config={draft.config}
                  onConfigChange={(config) => set({ config })}
                  secrets={draft.secrets}
                  onSecretsChange={(secrets) => set({ secrets })}
                  storedSecrets={connection?.storedSecrets ?? []}
                  errors={fieldErrors}
                  disabled={pending}
                  removed={draft.removed}
                  onRemovedChange={(removed) => set({ removed })}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
              )}
            </section>

            <fieldset className="grid min-w-0 gap-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-semibold">{ts('legend')}</legend>
              <div className="flex items-start gap-3">
                <Switch
                  id={`${id}-insecure`}
                  checked={draft.allowInsecureHttp}
                  disabled={pending}
                  aria-describedby={`${id}-insecure-hint`}
                  onCheckedChange={(on) =>
                    on ? setConfirmInsecure(true) : set({ allowInsecureHttp: false })
                  }
                />
                <div className="grid min-w-0 gap-0.5">
                  <Label htmlFor={`${id}-insecure`}>{ts('allowInsecure')}</Label>
                  <p
                    id={`${id}-insecure-hint`}
                    className={
                      draft.allowInsecureHttp
                        ? 'text-xs text-warning-foreground'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {ts('allowInsecureHint')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Switch
                  id={`${id}-enabled`}
                  checked={draft.enabled}
                  disabled={pending}
                  aria-describedby={`${id}-enabled-hint`}
                  onCheckedChange={(enabled) => set({ enabled })}
                />
                <div className="grid min-w-0 gap-0.5">
                  <Label htmlFor={`${id}-enabled`}>{t('enabled')}</Label>
                  <p id={`${id}-enabled-hint`} className="text-xs text-muted-foreground">
                    {t('enabledHint')}
                  </p>
                </div>
              </div>
            </fieldset>

            <div className="grid gap-2">
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runTest}
                  loading={test.isPending}
                  disabled={!type}
                >
                  <PlugZapIcon /> {t('test')}
                </Button>
              </div>
              <div role="status" aria-live="polite" className="min-h-5">
                {result && <TestResultNote result={result} />}
              </div>
            </div>
          </SheetBody>
          <SheetFooter className="flex-col gap-2">
            {rootError && (
              <p role="alert" className="text-sm text-destructive sm:mr-auto">
                {rootError}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {editing ? tc('saveChanges') : t('create')}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
      <ConfirmDialog
        open={confirmInsecure}
        onOpenChange={setConfirmInsecure}
        title={ts('confirmTitle')}
        description={ts('confirmDescription')}
        confirmLabel={ts('confirm')}
        destructive
        onConfirm={() => {
          set({ allowInsecureHttp: true });
          setConfirmInsecure(false);
        }}
      />
    </Sheet>
  );
}
