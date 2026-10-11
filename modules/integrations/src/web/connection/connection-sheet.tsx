'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Slot, useSlot } from '@isbp/sdk/web';
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
import { LockOpenIcon, PlugZapIcon } from 'lucide-react';
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
      <Banner
        status="success"
        title={result.account ? t('testOkAccount', { account: result.account }) : t('testOk')}
        description={result.message || undefined}
        collapsible={false}
      />
    );
  return (
    <VStack gap={1}>
      <Banner
        status="error"
        title={result.code && te.has(result.code) ? te(result.code) : t('testFailed')}
        description={result.message || undefined}
        collapsible={false}
      />
      {result.code === 'INSECURE_HTTP' && (
        <HStack gap={1.5} vAlign="start">
          <Icon icon={LockOpenIcon} color="secondary" />
          <Text type="supporting">{t('insecureHint')}</Text>
        </HStack>
      )}
    </VStack>
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

  const nameError = submitted && !draft.name.trim() ? t('nameRequired') : fieldErrors.name || null;
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
          <SheetTitle>
            <HStack gap={2} vAlign="center">
              <ModuleIcon name={connector?.icon} className="size-4" />
              {editing
                ? t('editTitle', { name: connection!.name })
                : t('createTitle', { connector: connector?.name ?? type })}
            </HStack>
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
          <SheetBody className="py-2">
            <FormLayout defaultOptionality="optional">
              <TextInput
                label={t('name')}
                isRequired
                value={draft.name}
                autoComplete="off"
                placeholder={t('namePlaceholder')}
                description={t('nameHint')}
                status={nameError ? { type: 'error', message: nameError } : undefined}
                onChange={(name) => set({ name: name.slice(0, 120) })}
              />

              <VStack gap={4} role="group" aria-labelledby={`${id}-settings`} className="min-w-0">
                <Text type="label" as="div" role="heading" aria-level={3} id={`${id}-settings`}>
                  {t('settings')}
                </Text>
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
                  <Text color="secondary">{t('unavailable')}</Text>
                )}
              </VStack>

              <VStack gap={3} role="group" aria-labelledby={`${id}-security`} className="min-w-0">
                <Text type="label" id={`${id}-security`}>
                  {ts('legend')}
                </Text>
                <Switch
                  label={ts('allowInsecure')}
                  description={ts('allowInsecureHint')}
                  value={draft.allowInsecureHttp}
                  isDisabled={pending}
                  onChange={(on) => (on ? setConfirmInsecure(true) : set({ allowInsecureHttp: false }))}
                />
                <Switch
                  label={t('enabled')}
                  description={t('enabledHint')}
                  value={draft.enabled}
                  isDisabled={pending}
                  onChange={(enabled) => set({ enabled })}
                />
              </VStack>

              <VStack gap={2}>
                <div>
                  <Button
                    label={t('test')}
                    variant="secondary"
                    icon={<Icon icon={PlugZapIcon} />}
                    isLoading={test.isPending}
                    isDisabled={!type}
                    type="button"
                    onClick={runTest}
                  />
                </div>
                <div aria-live="polite">{result && <TestResultNote result={result} />}</div>
              </VStack>

              {rootError && <Banner status="error" title={rootError} collapsible={false} />}
            </FormLayout>
          </SheetBody>
          <SheetFooter>
            <Button
              label={tc('cancel')}
              variant="ghost"
              isDisabled={pending}
              type="button"
              onClick={() => onOpenChange(false)}
            />
            <Button
              label={editing ? tc('saveChanges') : t('create')}
              variant="primary"
              isLoading={pending}
              type="submit"
            />
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
