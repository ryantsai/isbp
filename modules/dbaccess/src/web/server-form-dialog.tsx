'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { usePlatform } from '@isbp/sdk/web';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  accountNameFor,
  type AuthMode,
  authModesFor,
  type ConnectionInfo,
  type CreateServerInput,
  ENVIRONMENTS,
  type GroupOption,
  isManagedEngine,
  PASSWORD_LENGTH,
  patternProblem,
  type Server,
} from '../contracts';
import { INVALIDATE } from './lib';

const NONE = '__none__';
const DEFAULT_PATTERN = '{username}';
/** Lists longer than this get a search box in the dropdown. */
const SEARCH_FROM = 8;

type Target = { kind: 'create'; connection: ConnectionInfo } | { kind: 'edit'; server: Server };

/** Manage accounts on an admin connection (create), or change a server's settings (edit). */
export function ServerFormDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Target | null;
  onClose: () => void;
  onSaved?: (s: Server) => void;
}) {
  const t = useTranslations('dbaccess.serverForm');
  // The form (and its header) mounts after the dialog opens, so name the dialog here: Astryx reads the title at mount.
  return (
    <Dialog
      isOpen={Boolean(target)}
      onOpenChange={(o) => !o && onClose()}
      width={576}
      purpose="form"
      aria-label={
        target?.kind === 'edit'
          ? t('editTitle', { name: target.server.displayName })
          : target
            ? t('createTitle')
            : undefined
      }
    >
      {target && (
        <ServerForm
          key={target.kind === 'edit' ? target.server.id : target.connection.id}
          target={target}
          onCancel={onClose}
          onSaved={(s) => {
            onClose();
            onSaved?.(s);
          }}
        />
      )}
    </Dialog>
  );
}

function ServerForm({
  target,
  onCancel,
  onSaved,
}: {
  target: Target;
  onCancel: () => void;
  onSaved: (s: Server) => void;
}) {
  const t = useTranslations('dbaccess.serverForm');
  const te = useTranslations('dbaccess.environment');
  const ta = useTranslations('dbaccess.authMode');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { user } = usePlatform();
  const list = useFieldList();
  const formId = useId();
  const engine = target.kind === 'edit' ? target.server.engine : target.connection.engine;
  const managed = isManagedEngine(engine) ? engine : 'postgres';
  const s = target.kind === 'edit' ? target.server : null;
  const [v, setV] = useState({
    displayName: s?.displayName ?? (target.kind === 'create' ? target.connection.name : ''),
    environment: s?.environment ?? 'production',
    accountPattern: s?.accountPattern ?? DEFAULT_PATTERN,
    authMode: (s?.authMode ?? 'password') as AuthMode,
    windowsDomain: s?.windowsDomain ?? '',
    passwordLength: s?.passwordLength ?? PASSWORD_LENGTH.default,
    autoSync: s?.autoSync ?? true,
    ownerGroupId: s?.ownerGroup?.id ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const groups = useApiQuery<{ items: GroupOption[] }>('/dbaccess/lookups/groups');
  const save = useApiMutation(
    (api, body: CreateServerInput) =>
      target.kind === 'edit'
        ? api.patch<Server>(`/dbaccess/servers/${target.server.id}`, body)
        : api.post<Server>('/dbaccess/servers', body),
    { invalidate: INVALIDATE, success: t('saved'), silent: true, onSuccess: onSaved },
  );
  const patch = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const preview = accountNameFor(v.accountPattern, { username: user.username, email: user.email }, managed);
  const problem = patternProblem(v.accountPattern);
  const detailsFilled = countFilled(
    v.accountPattern !== DEFAULT_PATTERN,
    v.authMode === 'password' && v.passwordLength !== PASSWORD_LENGTH.default,
    !v.autoSync,
  );
  const groupItems = groups.data?.items ?? [];

  return (
    <Layout
      header={
        <DialogHeader
          title={
            target.kind === 'edit' ? t('editTitle', { name: target.server.displayName }) : t('createTitle')
          }
          subtitle={
            target.kind === 'create'
              ? t('createDescription', { connection: target.connection.name })
              : t('editDescription')
          }
          onOpenChange={(o) => !o && onCancel()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form
            id={formId}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!v.displayName.trim()) return setError(t('nameRequired'));
              if (problem) return setError(t(`pattern.${problem}`));
              if (v.authMode === 'windows' && !v.windowsDomain.trim()) return setError(t('domainRequired'));
              setError(null);
              save.mutate(
                {
                  ...(target.kind === 'create' ? { connectionId: target.connection.id } : {}),
                  displayName: v.displayName.trim(),
                  environment: v.environment,
                  accountPattern: v.accountPattern.trim(),
                  authMode: v.authMode,
                  windowsDomain: v.authMode === 'windows' ? v.windowsDomain.trim().toUpperCase() : null,
                  passwordLength: v.passwordLength,
                  autoSync: v.autoSync,
                  ownerGroupId: v.ownerGroupId,
                } as CreateServerInput,
                { onError: (err) => setError(errorText(err)) },
              );
            }}
          >
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 240 }} gap={4}>
                <TextInput
                  label={t('displayName')}
                  isRequired
                  value={v.displayName}
                  onChange={(displayName) => patch({ displayName: displayName.slice(0, 120) })}
                />
                <Selector
                  label={t('environment')}
                  value={v.environment}
                  onChange={(x) => patch({ environment: x as typeof v.environment })}
                  options={ENVIRONMENTS.map((x) => ({ value: x, label: te(x) }))}
                />
                <Selector
                  label={t('authMode')}
                  value={v.authMode}
                  onChange={(x) => patch({ authMode: x as AuthMode })}
                  options={authModesFor(managed).map((x) => ({ value: x, label: ta(x) }))}
                />
                {v.authMode === 'windows' ? (
                  <TextInput
                    label={t('domain')}
                    isRequired
                    value={v.windowsDomain}
                    placeholder="CONTOSO"
                    onChange={(windowsDomain) => patch({ windowsDomain: windowsDomain.slice(0, 15) })}
                  />
                ) : v.authMode === 'password' ? null : (
                  <Text type="supporting">{t('externalHint')}</Text>
                )}
                <Selector
                  label={t('ownerGroup')}
                  value={v.ownerGroupId ?? NONE}
                  description={t('ownerGroupHint')}
                  hasSearch={groupItems.length > SEARCH_FROM}
                  onChange={(x) => patch({ ownerGroupId: x === NONE ? null : x })}
                  options={[
                    { value: NONE, label: t('noGroup') },
                    ...groupItems.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
              </Grid>
              <OptionalFields
                hint={list([t('pattern.label'), t('passwordLength'), t('autoSync')])}
                filled={detailsFilled}
              >
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  <GridSpan columns="full">
                    <TextInput
                      label={t('pattern.label')}
                      value={v.accountPattern}
                      description={problem ? undefined : t('pattern.preview', { name: preview ?? '—' })}
                      status={problem ? { type: 'error', message: t(`pattern.${problem}`) } : undefined}
                      onChange={(accountPattern) => patch({ accountPattern: accountPattern.slice(0, 60) })}
                    />
                  </GridSpan>
                  {v.authMode === 'password' && (
                    <NumberInput
                      label={t('passwordLength')}
                      min={PASSWORD_LENGTH.min}
                      max={PASSWORD_LENGTH.max}
                      isIntegerOnly
                      value={v.passwordLength}
                      description={t('passwordHint', { min: PASSWORD_LENGTH.min, max: PASSWORD_LENGTH.max })}
                      onChange={(n) => patch({ passwordLength: n || PASSWORD_LENGTH.default })}
                    />
                  )}
                  <Switch
                    label={t('autoSync')}
                    value={v.autoSync}
                    onChange={(autoSync) => patch({ autoSync })}
                  />
                </Grid>
              </OptionalFields>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={onCancel} />
            <Button
              label={target.kind === 'edit' ? tc('saveChanges') : t('create')}
              variant="primary"
              isLoading={save.isPending}
              type="submit"
              form={formId}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
